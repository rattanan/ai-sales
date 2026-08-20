import { createHash } from "node:crypto";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import {
  metadataContextSchema,
  type MetadataContext,
} from "@/schemas/analysis";
import { getDataSourceConnector } from "./data-source-service";
import { sanitizeSampleRow } from "./sensitive-data";
import { failure, success } from "@/types/result";
import type { AppResult } from "@/types/result";
import { getEffectiveAiPrivacyPolicy } from "./privacy-policy";
import type { PiiMaskingRules } from "./sensitive-data";

export type MetadataTableSnapshot = {
  id: string;
  schema: string;
  name: string;
  kind: "TABLE" | "VIEW";
  estimatedRowCount: bigint | null;
  databaseComment?: string | null;
  semanticDescription?: string | null;
  sampleDataEnabled?: boolean;
  columns: Array<{
    name: string;
    dataType: string;
    nullable: boolean;
    primaryKey: boolean;
    ordinal: number;
    databaseComment?: string | null;
    semanticDescription?: string | null;
  }>;
};

export type MetadataRelationshipSnapshot = {
  name: string;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
};

export type MetadataContextInput = {
  dataSourceName: string;
  dataSourceType?: "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE";
  tables: MetadataTableSnapshot[];
  relationships: MetadataRelationshipSnapshot[];
  businessObjective: MetadataContext["businessObjective"];
  dashboardPreferences: MetadataContext["dashboardPreferences"];
};

export type MetadataContextLimits = {
  maxTables: number;
  maxColumnsPerTable: number;
  sampleRowsPerTable: number;
  maxSampleCellLength: number;
  maxContextCharacters: number;
  sendSampleData: boolean;
  maskSensitiveData: boolean;
  maskingRules?: PiiMaskingRules;
};

const MAX_REPORTED_OMITTED_TABLES = 100;
// Structured-output providers must reserve context for the response schema and
// generated recommendations. Keep the metadata payload conservative even when
// the provider advertises a larger raw context window.
export const STRUCTURED_AI_METADATA_MAX_CHARACTERS = 40_000;

type SampleLoader = (
  table: MetadataTableSnapshot,
  limit: number,
) => Promise<AppResult<Record<string, unknown>[]>>;

function objectiveTokens(input: MetadataContextInput) {
  return new Set(
    Object.values(input.businessObjective)
      .filter((value): value is string => Boolean(value))
      .join(" ")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 3),
  );
}

function rankTables(input: MetadataContextInput) {
  const tokens = objectiveTokens(input);
  const relationshipDegree = new Map<string, number>();
  for (const relationship of input.relationships) {
    relationshipDegree.set(
      relationship.fromTable,
      (relationshipDegree.get(relationship.fromTable) ?? 0) + 1,
    );
    relationshipDegree.set(
      relationship.toTable,
      (relationshipDegree.get(relationship.toTable) ?? 0) + 1,
    );
  }
  return [...input.tables].sort((left, right) => {
    const score = (table: MetadataTableSnapshot) => {
      const searchable = [
        table.schema,
        table.name,
        ...table.columns.map((c) => c.name),
      ]
        .join(" ")
        .toLowerCase();
      const relevance =
        [...tokens].filter((token) => searchable.includes(token)).length * 10;
      const relations =
        relationshipDegree.get(`${table.schema}.${table.name}`) ?? 0;
      const primaryKey = table.columns.some((column) => column.primaryKey)
        ? 2
        : 0;
      return relevance + relations * 3 + primaryKey;
    };
    return (
      score(right) - score(left) ||
      `${left.schema}.${left.name}`.localeCompare(
        `${right.schema}.${right.name}`,
      )
    );
  });
}

function serializedLength(context: MetadataContext) {
  return JSON.stringify(context).length;
}

function enforceCharacterLimit(
  context: MetadataContext,
  maxCharacters: number,
) {
  let samplesReduced = false;
  while (serializedLength(context) > maxCharacters) {
    const candidate = [...context.tables]
      .sort((a, b) => b.sampleRows.length - a.sampleRows.length)
      .find((table) => table.sampleRows.length > 0);
    if (!candidate) break;
    candidate.sampleRows.pop();
    samplesReduced = true;
  }
  if (samplesReduced)
    context.scopeReduction.warnings.push(
      "Sample rows were reduced to satisfy the configured context size limit.",
    );

  let columnsReduced = false;
  while (serializedLength(context) > maxCharacters) {
    const candidate = [...context.tables]
      .reverse()
      .find((table) => table.columns.length > 1);
    if (!candidate) break;
    candidate.columns.pop();
    candidate.omittedColumnCount += 1;
    columnsReduced = true;
  }
  if (columnsReduced)
    context.scopeReduction.warnings.push(
      "Additional columns were summarized to satisfy the configured context size limit.",
    );
  let tablesReduced = false;
  while (
    serializedLength(context) > maxCharacters &&
    context.tables.length > 1
  ) {
    const omitted = context.tables.pop();
    if (!omitted) break;
    if (
      context.scopeReduction.omittedTables.length < MAX_REPORTED_OMITTED_TABLES
    )
      context.scopeReduction.omittedTables.push(
        `${omitted.schema}.${omitted.name}`,
      );
    tablesReduced = true;
  }
  if (tablesReduced) {
    context.scopeReduction.includedTableCount = context.tables.length;
    context.scopeReduction.warnings.push(
      "Additional tables were omitted to satisfy the configured AI context size limit.",
    );
  }
  context.scopeReduction.omittedColumns = context.tables
    .filter((table) => table.omittedColumnCount > 0)
    .map((table) => ({
      table: `${table.schema}.${table.name}`,
      count: table.omittedColumnCount,
    }));
  if (serializedLength(context) > maxCharacters) {
    const primary = context.tables[0];
    context.tables = primary
      ? [
          {
            ...primary,
            columns: [],
            sampleRows: [],
            omittedColumnCount:
              primary.omittedColumnCount + primary.columns.length,
          },
        ]
      : [];
    context.relationships = [];
    context.scopeReduction.includedTableCount = context.tables.length;
    context.scopeReduction.omittedColumns = [];
    context.scopeReduction.warnings.push(
      "Metadata was reduced to an ultra-compact scope to satisfy the configured AI context limit.",
    );
  }
}

export async function buildMetadataContext(
  input: MetadataContextInput,
  limits: MetadataContextLimits,
  sampleLoader?: SampleLoader,
) {
  const ranked = rankTables(input);
  const included = ranked.slice(0, limits.maxTables);
  const allOmittedTables = ranked
    .slice(limits.maxTables)
    .map((table) => `${table.schema}.${table.name}`);
  const omittedTables = allOmittedTables.slice(0, MAX_REPORTED_OMITTED_TABLES);
  const warnings: string[] = [];
  if (allOmittedTables.length)
    warnings.push(
      `${allOmittedTables.length} selected table(s) were omitted by the configured AI table limit.`,
    );
  if (!limits.sendSampleData)
    warnings.push("Sample data is disabled; analysis uses metadata only.");
  else if (!sampleLoader || limits.sampleRowsPerTable === 0)
    warnings.push("No sample rows were included; analysis uses metadata only.");

  const tables: MetadataContext["tables"] = [];
  for (const table of included) {
    const columns = [...table.columns]
      .sort((a, b) => a.ordinal - b.ordinal)
      .slice(0, limits.maxColumnsPerTable)
      .map((column) => ({
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        databaseComment: column.databaseComment ?? null,
        semanticDescription: column.semanticDescription ?? null,
      }));
    let sampleRows: Record<string, unknown>[] = [];
    if (
      limits.sendSampleData &&
      table.sampleDataEnabled === true &&
      sampleLoader &&
      limits.sampleRowsPerTable > 0
    ) {
      const samples = await sampleLoader(table, limits.sampleRowsPerTable);
      if (!samples.ok) return samples;
      sampleRows = samples.data.map((row) =>
        sanitizeSampleRow(row, {
          maskSensitiveData: limits.maskSensitiveData,
          maskingRules: limits.maskingRules,
          maxLength: limits.maxSampleCellLength,
        }),
      );
    }
    tables.push({
      schema: table.schema,
      name: table.name,
      kind: table.kind,
      estimatedRowCount: table.estimatedRowCount?.toString() ?? null,
      databaseComment: table.databaseComment ?? null,
      semanticDescription: table.semanticDescription ?? null,
      columns,
      omittedColumnCount: Math.max(0, table.columns.length - columns.length),
      sampleRows,
    });
  }
  const includedNames = new Set(
    tables.map((table) => `${table.schema}.${table.name}`),
  );
  const context: MetadataContext = {
    version: 1,
    dataSourceType: input.dataSourceType ?? "MYSQL",
    dataSourceName: input.dataSourceName,
    tables,
    relationships: input.relationships.filter(
      (relationship) =>
        includedNames.has(relationship.fromTable) &&
        includedNames.has(relationship.toTable),
    ),
    businessObjective: input.businessObjective,
    dashboardPreferences: input.dashboardPreferences,
    scopeReduction: {
      selectedTableCount: ranked.length,
      includedTableCount: included.length,
      omittedTables,
      omittedColumns: tables
        .filter((table) => table.omittedColumnCount > 0)
        .map((table) => ({
          table: `${table.schema}.${table.name}`,
          count: table.omittedColumnCount,
        })),
      sampleDataIncluded:
        limits.sendSampleData &&
        Boolean(sampleLoader) &&
        limits.sampleRowsPerTable > 0,
      sensitiveDataMasked:
        limits.sendSampleData &&
        Boolean(sampleLoader) &&
        limits.sampleRowsPerTable > 0 &&
        limits.maskSensitiveData,
      warnings,
    },
  };
  enforceCharacterLimit(context, limits.maxContextCharacters);
  const parsed = metadataContextSchema.safeParse(context);
  if (
    !parsed.success ||
    serializedLength(context) > limits.maxContextCharacters
  )
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "The selected metadata cannot fit within the configured AI context limit.",
      {
        diagnostics: {
          selectedTables: ranked.length,
          contextCharacters: serializedLength(context),
          maxContextCharacters: limits.maxContextCharacters,
        },
      },
    );
  const serialized = JSON.stringify(parsed.data);
  return success({
    context: parsed.data,
    serialized,
    hash: createHash("sha256").update(serialized).digest("hex"),
  });
}

export async function buildMetadataContextForDashboard(
  authorization: AuthorizationContext,
  dashboardId: string,
) {
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId: authorization.workspaceId },
    include: {
      dataSources: {
        include: {
          dataSource: {
            select: {
              id: true,
              name: true,
              type: true,
              sampleDataEnabled: true,
            },
          },
        },
      },
    },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");
  if (dashboard.dataSources.length !== 1)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Phase 1 analysis requires exactly one data source.",
    );
  const source = dashboard.dataSources[0].dataSource;
  if (
    source.type !== "MYSQL" &&
    source.type !== "POSTGRESQL" &&
    source.type !== "MSSQL" &&
    source.type !== "ORACLE"
  )
    return failure(
      "CONNECTOR_NOT_IMPLEMENTED",
      "Live analysis supports MySQL, PostgreSQL, SQL Server, and Oracle data sources.",
    );
  if (!dashboard.businessObjective)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Complete the dashboard business objective before analysis.",
    );
  const selectedTables = await db.dataSourceTable.findMany({
    where: { selected: true, schema: { dataSourceId: source.id } },
    include: {
      schema: { select: { name: true } },
      columns: { orderBy: { ordinal: "asc" } },
      outgoingRelations: {
        include: {
          toTable: { include: { schema: { select: { name: true } } } },
        },
      },
    },
    orderBy: [{ schema: { name: "asc" } }, { name: "asc" }],
  });
  if (!selectedTables.length)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Select at least one discovered table before analysis.",
    );
  const input: MetadataContextInput = {
    dataSourceName: source.name,
    dataSourceType: source.type,
    tables: selectedTables.map((table) => ({
      id: table.id,
      schema: table.schema.name,
      name: table.name,
      kind: table.tableType === "VIEW" ? "VIEW" : "TABLE",
      estimatedRowCount: table.estimatedRowCount,
      databaseComment: table.databaseComment,
      semanticDescription: table.semanticDescription,
      sampleDataEnabled: table.sampleDataEnabled,
      columns: table.columns.map((column) => ({
        name: column.name,
        dataType: column.dataType,
        nullable: column.nullable,
        primaryKey: column.primaryKey,
        ordinal: column.ordinal,
        databaseComment: column.databaseComment,
        semanticDescription: column.semanticDescription,
      })),
    })),
    relationships: selectedTables.flatMap((table) =>
      table.outgoingRelations.map((relationship) => ({
        name: relationship.name,
        fromTable: `${table.schema.name}.${table.name}`,
        fromColumn: relationship.fromColumnName,
        toTable: `${relationship.toTable.schema.name}.${relationship.toTable.name}`,
        toColumn: relationship.toColumnName,
      })),
    ),
    businessObjective: {
      area: dashboard.businessArea,
      objective: dashboard.businessObjective,
      questions: dashboard.businessQuestions,
      desiredKpis: dashboard.desiredKpis,
      targetAudience: dashboard.targetUsers,
      reportingPeriod: dashboard.reportingPeriod,
      importantFilters: dashboard.importantFilters,
    },
    dashboardPreferences: {
      layout: dashboard.layoutStyle,
      visualStyle: dashboard.visualStyle,
      theme: dashboard.visualTheme,
    },
  };
  const configuration = env();
  const privacyPolicy = await getEffectiveAiPrivacyPolicy(
    authorization.organizationId,
  );
  const limits: MetadataContextLimits = {
    maxTables: configuration.AI_MAX_TABLES,
    maxColumnsPerTable: configuration.AI_MAX_COLUMNS_PER_TABLE,
    sampleRowsPerTable: configuration.AI_SAMPLE_ROWS_PER_TABLE,
    maxSampleCellLength: configuration.AI_MAX_SAMPLE_CELL_LENGTH,
    maxContextCharacters: Math.min(
      configuration.AI_MAX_CONTEXT_CHARACTERS,
      STRUCTURED_AI_METADATA_MAX_CHARACTERS,
    ),
    sendSampleData: privacyPolicy.sendSampleData && source.sampleDataEnabled,
    maskSensitiveData: privacyPolicy.maskSensitiveData,
    maskingRules: privacyPolicy.maskingRules,
  };
  if (!limits.sendSampleData) return buildMetadataContext(input, limits);

  const resolved = await getDataSourceConnector(authorization, source.id);
  if (!resolved.ok) return resolved;
  try {
    return await buildMetadataContext(input, limits, async (table, limit) => {
      return resolved.data.connector.fetchSample(
        table.schema,
        table.name,
        limit,
      );
    });
  } finally {
    await resolved.data.connector.close();
  }
}
