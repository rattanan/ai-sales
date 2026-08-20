import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { validateGroundedReadOnlySql } from "@/server/connectors/sql-grounding";
import type { DataConnector } from "@/server/connectors/types";
import { db } from "@/server/db";
import { metadataContextSchema } from "@/schemas/analysis";
import { env } from "@/schemas/env";
import { failure, success } from "@/types/result";
import { getDataSourceConnector } from "./data-source-service";

function sqlHash(sql: string) {
  return createHash("sha256").update(sql).digest("hex");
}

function validationPayload(message: string) {
  return [{ code: "QUERY_VALIDATION_FAILED", message }];
}

async function resolveJobContext(
  authorization: AuthorizationContext,
  analysisJobId: string,
) {
  const job = await db.analysisJob.findFirst({
    where: { id: analysisJobId, workspaceId: authorization.workspaceId },
    select: { id: true, dataSourceId: true },
  });
  if (!job) return failure("NOT_FOUND", "Analysis job not found.");
  const artifact = await db.analysisArtifact.findFirst({
    where: { analysisJobId: job.id, type: "METADATA_CONTEXT" },
    orderBy: { revision: "desc" },
    select: { payload: true },
  });
  const parsed = metadataContextSchema.safeParse(artifact?.payload);
  if (!parsed.success)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "The analysis job does not have a valid approved metadata context.",
    );
  return success({ job, metadataContext: parsed.data });
}

export async function createValidatedQueryDefinition(
  authorization: AuthorizationContext,
  input: {
    analysisJobId: string;
    recommendationId?: string;
    purpose: string;
    sql: string;
  },
) {
  const resolved = await resolveJobContext(authorization, input.analysisJobId);
  if (!resolved.ok) return resolved;
  if (input.recommendationId) {
    const recommendation = await db.analysisRecommendation.findFirst({
      where: {
        id: input.recommendationId,
        analysisJobId: resolved.data.job.id,
      },
      select: { id: true },
    });
    if (!recommendation)
      return failure("NOT_FOUND", "Analysis recommendation not found.");
  }
  const configuration = env();
  const validation = validateGroundedReadOnlySql(
    input.sql,
    resolved.data.metadataContext,
    configuration.QUERY_MAX_ROWS,
  );
  const query = await db.queryDefinition.create({
    data: {
      analysisJobId: resolved.data.job.id,
      recommendationId: input.recommendationId,
      purpose: input.purpose,
      sql: validation.ok ? validation.data.sql : input.sql,
      sqlHash: sqlHash(validation.ok ? validation.data.sql : input.sql),
      validationStatus: validation.ok ? "VALID" : "INVALID",
      validationErrors: validation.ok
        ? undefined
        : (validationPayload(
            validation.error.message,
          ) as Prisma.InputJsonValue),
    },
  });
  if (!validation.ok)
    return failure("QUERY_VALIDATION_FAILED", validation.error.message, {
      requestId: validation.error.requestId,
      diagnostics: { queryDefinitionId: query.id },
    });
  return success({
    id: query.id,
    sql: query.sql,
    sqlHash: query.sqlHash,
    tables: validation.data.tables,
  });
}

function normalizeQueryValue(value: unknown): unknown {
  if (
    value == null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[BINARY]";
  if (Array.isArray(value)) return value.map(normalizeQueryValue);
  if (typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeQueryValue(nested),
      ]),
    );
  return String(value);
}

function resultSchema(rows: Record<string, unknown>[]) {
  const fields = new Map<string, Set<string>>();
  for (const row of rows.slice(0, 20)) {
    for (const [name, value] of Object.entries(row)) {
      const type =
        value == null
          ? "null"
          : value instanceof Date
            ? "date"
            : Buffer.isBuffer(value)
              ? "binary"
              : typeof value;
      const types = fields.get(name) ?? new Set<string>();
      types.add(type);
      fields.set(name, types);
    }
  }
  return [...fields.entries()].map(([name, types]) => ({
    name,
    types: [...types].sort(),
  }));
}

export async function executeQueryDefinition(
  authorization: AuthorizationContext,
  queryDefinitionId: string,
  providedConnector?: DataConnector,
) {
  const query = await db.queryDefinition.findFirst({
    where: {
      id: queryDefinitionId,
      analysisJob: { workspaceId: authorization.workspaceId },
    },
    include: {
      analysisJob: { select: { id: true, dataSourceId: true } },
    },
  });
  if (!query) return failure("NOT_FOUND", "Query definition not found.");
  if (query.validationStatus !== "VALID")
    return failure(
      "QUERY_VALIDATION_FAILED",
      "Only validated query definitions can be executed.",
    );
  const resolved = await resolveJobContext(authorization, query.analysisJob.id);
  if (!resolved.ok) return resolved;
  const configuration = env();
  const validation = validateGroundedReadOnlySql(
    query.sql,
    resolved.data.metadataContext,
    configuration.QUERY_MAX_ROWS,
  );
  if (!validation.ok) return validation;

  const requestId = crypto.randomUUID();
  const execution = await db.queryExecution.create({
    data: {
      analysisJobId: query.analysisJob.id,
      queryDefinitionId: query.id,
      requestId,
    },
  });
  let connector = providedConnector;
  let ownsConnector = false;
  if (!connector) {
    const resolvedConnector = await getDataSourceConnector(
      authorization,
      query.analysisJob.dataSourceId,
    );
    if (!resolvedConnector.ok) {
      await db.queryExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          errorCode: resolvedConnector.error.code,
          errorMessage: resolvedConnector.error.message,
        },
      });
      return resolvedConnector;
    }
    connector = resolvedConnector.data.connector;
    ownsConnector = true;
  }
  const startedAt = performance.now();
  try {
    const result = await connector.executeReadOnlyQuery(validation.data.sql, {
      timeoutMs: configuration.QUERY_TIMEOUT_MS,
    });
    const durationMs = Math.round(performance.now() - startedAt);
    if (!result.ok) {
      await db.queryExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          durationMs,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        },
      });
      return failure("QUERY_EXECUTION_FAILED", result.error.message, {
        requestId: result.error.requestId,
        diagnostics: { executionId: execution.id },
      });
    }
    const previewRows = result.data
      .slice(0, configuration.QUERY_PREVIEW_ROWS)
      .map((row) => normalizeQueryValue(row) as Record<string, unknown>);
    const schema = resultSchema(result.data);
    await db.$transaction([
      db.queryExecution.update({
        where: { id: execution.id },
        data: {
          status: "SUCCEEDED",
          completedAt: new Date(),
          durationMs,
          rowCount: result.data.length,
          previewRows: previewRows as Prisma.InputJsonValue,
        },
      }),
      db.queryDefinition.update({
        where: { id: query.id },
        data: { resultSchema: schema as Prisma.InputJsonValue },
      }),
    ]);
    return success({
      executionId: execution.id,
      durationMs,
      rowCount: result.data.length,
      previewRows,
      resultSchema: schema,
    });
  } finally {
    if (ownsConnector) await connector.close();
  }
}
