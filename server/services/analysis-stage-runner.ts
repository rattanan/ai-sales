import { createHash } from "node:crypto";
import { Prisma, type AnalysisJob } from "@/generated/prisma/client";
import type {
  DashboardWidgetDefinition,
  KPIRecommendation,
  MetadataContext,
} from "@/schemas/analysis";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import {
  businessSchemaAnalysisSchema,
  dashboardPlanSchema,
  generatedInsightsSchema,
  kpiRecommendationsSchema,
  metadataContextSchema,
  sqlRepairSchema,
  widgetDefinitionsSchema,
} from "@/schemas/analysis";
import { env } from "@/schemas/env";
import { generateCachedStructuredOutput } from "@/server/ai/cached-provider";
import { getEffectiveAiPrivacyPolicy } from "./privacy-policy";
import {
  DASHBOARD_DESIGN_PROMPT,
  DASHBOARD_TEMPLATES,
  scoreDashboardQuality,
  validateDashboardQuality,
} from "@/server/ai/dashboard-design";
import {
  validateBusinessSchemaGrounding,
  validateDashboardPlanGrounding,
  validateInsightGrounding,
  validateKpiGrounding,
  validateWidgetGrounding,
} from "@/server/ai/grounding";
import {
  GROUNDING_SYSTEM_PROMPT,
  metadataTaskPrompt,
  PROMPT_VERSIONS,
} from "@/server/ai/prompts";
import { validateGroundedReadOnlySql } from "@/server/connectors/sql-grounding";
import { failure, success } from "@/types/result";
import {
  prepareMetadataStage,
  STAGE_PROGRESS,
  type AnalysisStageHandler,
} from "./analysis-job-service";
import { executeQueryDefinition } from "./query-service";
import { sanitizeSampleRow } from "./sensitive-data";
import { logger } from "./logger";
import { getDataSourceConnector } from "./data-source-service";

function contentHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function quotedIdentifier(
  value: string,
  dataSourceType: "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE",
) {
  if (dataSourceType === "MSSQL")
    return "[" + value.replaceAll("]", "]]") + "]";
  if (dataSourceType === "ORACLE" || dataSourceType === "POSTGRESQL")
    return `"${value.replaceAll('"', '""')}"`;
  return `\`${value.replaceAll("`", "``")}\``;
}

/**
 * A safe last resort when a provider cannot produce a grounded business KPI.
 * COUNT(*) needs no inferred measure column, so it remains valid even when the
 * metadata context had to omit columns to fit the model context window.
 */
function countFallbackKpi(context: MetadataContext): KPIRecommendation | null {
  const table = context.tables[0];
  if (!table) return null;
  const tableReference = `${table.schema}.${table.name}`;
  const source = `${quotedIdentifier(table.schema, context.dataSourceType)}.${quotedIdentifier(table.name, context.dataSourceType)}`;
  return {
    id: "approved-record-count",
    name: `${table.name} record count`,
    description: `Count of rows in the approved ${table.kind.toLowerCase()} ${tableReference}.`,
    businessQuestion: `How many records are currently available in ${tableReference}?`,
    calculationType: "COUNT",
    sourceTables: [tableReference],
    sourceColumns: [],
    filterAssumptions: [],
    proposedSql: `SELECT COUNT(*) AS ${quotedIdentifier("value", context.dataSourceType)} FROM ${source}`,
    displayFormat: "NUMBER",
    confidence: 0.65,
    limitations: [
      "Fallback KPI used because no AI-proposed KPI passed metadata grounding.",
      "This count does not apply business filters or date ranges.",
    ],
  };
}

function createJobHeartbeatReporter(job: AnalysisJob) {
  let lastUpdatedAt = 0;
  return async () => {
    const now = Date.now();
    if (now - lastUpdatedAt < 2_000) return;
    lastUpdatedAt = now;
    try {
      await db.analysisJob.updateMany({
        where: { id: job.id, runVersion: job.runVersion, status: "RUNNING" },
        data: { lastHeartbeatAt: new Date(now) },
      });
    } catch (error) {
      logger.warn("Analysis stream heartbeat update failed", {
        analysisJobId: job.id,
        requestId: job.requestId,
        error,
      });
    }
  };
}

async function latestArtifact(
  jobId: string,
  type: Prisma.AnalysisArtifactWhereInput["type"],
) {
  return db.analysisArtifact.findFirst({
    where: { analysisJobId: jobId, type },
    orderBy: { revision: "desc" },
  });
}

async function persistArtifact(input: {
  job: AnalysisJob;
  type: Prisma.AnalysisArtifactCreateInput["type"];
  stage: Prisma.AnalysisArtifactCreateInput["stage"];
  payload: Prisma.InputJsonValue;
  inputHash: string;
  promptVersion?: string;
  provider?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
}) {
  return db.analysisArtifact.upsert({
    where: {
      analysisJobId_type_revision: {
        analysisJobId: input.job.id,
        type: input.type,
        revision: 1,
      },
    },
    update: {},
    create: {
      analysisJobId: input.job.id,
      type: input.type,
      stage: input.stage,
      revision: 1,
      promptVersion: input.promptVersion,
      inputHash: input.inputHash,
      contentHash: contentHash(input.payload),
      provider: input.provider,
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      payload: input.payload,
    },
  });
}

async function metadataForJob(jobId: string) {
  const artifact = await latestArtifact(jobId, "METADATA_CONTEXT");
  const parsed = metadataContextSchema.safeParse(artifact?.payload);
  if (!parsed.success)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "The analysis metadata context is missing or invalid.",
    );
  return success({ context: parsed.data, artifact });
}

async function analyzeSchemaStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const metadata = await metadataForJob(job.id);
  if (!metadata.ok) return metadata;
  const response = await generateCachedStructuredOutput(context, {
    requestId: crypto.randomUUID(),
    schemaName: "business_schema_analysis",
    outputSchema: businessSchemaAnalysisSchema,
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    userPrompt: metadataTaskPrompt(
      "Identify the business entities, table roles, analytical columns, discovered relationship findings, data-quality risks, and questions requiring human confirmation. A relationshipName may be a concise human-readable label, but every fromTable and toTable pair must exactly match the endpoints of a relationship in the approved context.",
      JSON.stringify(metadata.data.context),
    ),
    promptVersion: PROMPT_VERSIONS.schemaAnalysis,
    onProgress: createJobHeartbeatReporter(job),
  });
  if (!response.ok) return response;
  let output = response.data;
  let grounded = validateBusinessSchemaGrounding(
    output.data,
    metadata.data.context,
  );
  for (
    let repairAttempt = 1;
    !grounded.ok && repairAttempt <= 2;
    repairAttempt++
  ) {
    const repaired = await generateCachedStructuredOutput(context, {
      requestId: crypto.randomUUID(),
      schemaName: "business_schema_analysis_repair",
      outputSchema: businessSchemaAnalysisSchema,
      systemPrompt: GROUNDING_SYSTEM_PROMPT,
      userPrompt: metadataTaskPrompt(
        `Repair the schema analysis. ${grounded.error.message} Use only exact table and column references present in the approved context. Repair attempt ${repairAttempt} of 2.`,
        JSON.stringify(metadata.data.context),
      ),
      promptVersion: `${PROMPT_VERSIONS.schemaAnalysis}-repair-${repairAttempt}`,
      onProgress: createJobHeartbeatReporter(job),
    });
    if (!repaired.ok) return repaired;
    output = repaired.data;
    grounded = validateBusinessSchemaGrounding(
      output.data,
      metadata.data.context,
    );
  }
  if (!grounded.ok) return grounded;
  await persistArtifact({
    job,
    type: "SCHEMA_ANALYSIS",
    stage: "ANALYZING_SCHEMA",
    payload: grounded.data as Prisma.InputJsonValue,
    inputHash: output.inputHash,
    promptVersion: output.promptVersion,
    provider: output.provider,
    model: output.model,
    inputTokens: output.usage?.inputTokens,
    outputTokens: output.usage?.outputTokens,
  });
  return success({
    nextStage: "IDENTIFYING_BUSINESS_ENTITIES" as const,
    progressPercent: STAGE_PROGRESS.IDENTIFYING_BUSINESS_ENTITIES,
  });
}

async function validateEntitiesStage(
  _context: AuthorizationContext,
  job: AnalysisJob,
) {
  const [metadata, analysisArtifact] = await Promise.all([
    metadataForJob(job.id),
    latestArtifact(job.id, "SCHEMA_ANALYSIS"),
  ]);
  if (!metadata.ok) return metadata;
  const analysis = businessSchemaAnalysisSchema.safeParse(
    analysisArtifact?.payload,
  );
  if (!analysis.success)
    return failure(
      "AI_INVALID_RESPONSE",
      "The persisted business schema analysis is invalid.",
    );
  const grounded = validateBusinessSchemaGrounding(
    analysis.data,
    metadata.data.context,
  );
  if (!grounded.ok) return grounded;
  return success({
    nextStage: "RECOMMENDING_KPIS" as const,
    progressPercent: STAGE_PROGRESS.RECOMMENDING_KPIS,
  });
}

async function recommendKpisStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const configuration = env();
  const [metadata, schemaArtifact] = await Promise.all([
    metadataForJob(job.id),
    latestArtifact(job.id, "SCHEMA_ANALYSIS"),
  ]);
  if (!metadata.ok) return metadata;
  const schemaAnalysis = businessSchemaAnalysisSchema.safeParse(
    schemaArtifact?.payload,
  );
  if (!schemaAnalysis.success)
    return failure("AI_INVALID_RESPONSE", "Schema analysis is unavailable.");
  const response = await generateCachedStructuredOutput(context, {
    requestId: crypto.randomUUID(),
    schemaName: "kpi_recommendations",
    outputSchema: kpiRecommendationsSchema(
      configuration.AI_MAX_KPI_RECOMMENDATIONS,
    ),
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    userPrompt: metadataTaskPrompt(
      `Recommend only KPIs supported by type-compatible approved columns. Include useful date/category filterableDimensions and return those dimensions as stable aliases in proposed SQL whenever the analytical grain permits, so dashboard widgets can filter real query results. Each proposed ${metadata.data.context.dataSourceType === "ORACLE" ? "Oracle" : "MySQL"} query must join tables only through the exact fromTable.fromColumn and toTable.toColumn pairs in approved relationships. When two tables have no direct relationship, use an approved bridge path or omit that KPI. ${metadata.data.context.dataSourceType === "ORACLE" ? "Use Oracle SELECT syntax, double-quote every schema, table, and column identifier exactly as supplied, and use FETCH FIRST n ROWS ONLY instead of LIMIT." : ""} Return real supporting data. Prefer KPI queries that support trends, comparisons, distributions, funnels, targets, and exception monitoring over scalar totals only.`,
      JSON.stringify({
        metadata: metadata.data.context,
        schemaAnalysis: schemaAnalysis.data,
      }),
    ),
    promptVersion: PROMPT_VERSIONS.kpiRecommendations,
    onProgress: createJobHeartbeatReporter(job),
  });
  if (!response.ok) return response;
  const groundedRecommendations: KPIRecommendation[] = [];
  for (const recommendation of response.data.data.recommendations) {
    let candidate = recommendation;
    let grounded = validateKpiGrounding(
      candidate,
      metadata.data.context,
      configuration.QUERY_MAX_ROWS,
    );
    for (
      let repairAttempt = 1;
      !grounded.ok && repairAttempt <= 2;
      repairAttempt++
    ) {
      const repaired = await generateCachedStructuredOutput(context, {
        requestId: crypto.randomUUID(),
        schemaName: "kpi_recommendation_repair",
        outputSchema: kpiRecommendationsSchema(1),
        systemPrompt: GROUNDING_SYSTEM_PROMPT,
        userPrompt: metadataTaskPrompt(
          `Repair the complete KPI recommendation. Return exactly one recommendation using only the supplied metadata and the exact schema.table.column references it contains. Validation code: ${grounded.error.code}. Validation message: ${grounded.error.message}. ${metadata.data.context.dataSourceType === "ORACLE" ? "Use double-quoted approved Oracle identifiers and FETCH FIRST n ROWS ONLY; never use LIMIT. " : ""}Every JOIN must use an exact approved relationship column pair. If its current aggregation is not compatible with an approved column, use COUNT(*) for one approved table. Original recommendation: ${JSON.stringify(candidate)}`,
          JSON.stringify(metadata.data.context),
        ),
        promptVersion: `kpi-recommendation-repair-v1-attempt-${repairAttempt}`,
        onProgress: createJobHeartbeatReporter(job),
      });
      // A repair is helpful but must not make the whole job fail; a grounded
      // fallback is preferable to retrying every AI request from the start.
      if (!repaired.ok) break;
      candidate = repaired.data.data.recommendations[0] ?? candidate;
      grounded = validateKpiGrounding(
        candidate,
        metadata.data.context,
        configuration.QUERY_MAX_ROWS,
      );
    }
    if (grounded.ok) groundedRecommendations.push(grounded.data);
  }
  if (!groundedRecommendations.length) {
    const fallback = countFallbackKpi(metadata.data.context);
    if (!fallback)
      return failure(
        "ANALYSIS_SCOPE_INVALID",
        "No approved table is available for a fallback KPI.",
      );
    const groundedFallback = validateKpiGrounding(
      fallback,
      metadata.data.context,
      configuration.QUERY_MAX_ROWS,
    );
    if (!groundedFallback.ok) return groundedFallback;
    groundedRecommendations.push(groundedFallback.data);
  }
  const payload = { recommendations: groundedRecommendations };
  const artifact = await persistArtifact({
    job,
    type: "KPI_RECOMMENDATIONS",
    stage: "RECOMMENDING_KPIS",
    payload: payload as Prisma.InputJsonValue,
    inputHash: response.data.inputHash,
    promptVersion: response.data.promptVersion,
    provider: response.data.provider,
    model: response.data.model,
    inputTokens: response.data.usage?.inputTokens,
    outputTokens: response.data.usage?.outputTokens,
  });
  for (const recommendation of groundedRecommendations) {
    await db.analysisRecommendation.upsert({
      where: {
        analysisJobId_type_externalId_revision: {
          analysisJobId: job.id,
          type: "KPI",
          externalId: recommendation.id,
          revision: 1,
        },
      },
      update: {},
      create: {
        analysisJobId: job.id,
        artifactId: artifact.id,
        type: "KPI",
        externalId: recommendation.id,
        title: recommendation.name,
        description: recommendation.description,
        payload: recommendation as Prisma.InputJsonValue,
      },
    });
  }
  return success({
    nextStage: "GENERATING_QUERIES" as const,
    progressPercent: STAGE_PROGRESS.GENERATING_QUERIES,
  });
}

async function generateQueriesStage(
  _context: AuthorizationContext,
  job: AnalysisJob,
) {
  const recommendations = await db.analysisRecommendation.findMany({
    where: { analysisJobId: job.id, type: "KPI", status: { not: "REJECTED" } },
  });
  if (!recommendations.length)
    return failure(
      "AI_INVALID_RESPONSE",
      "No grounded KPI recommendations are available for query generation.",
    );
  for (const recommendation of recommendations) {
    const parsed = kpiRecommendationsSchema(
      1,
    ).shape.recommendations.element.safeParse(recommendation.payload);
    if (!parsed.success)
      return failure("AI_INVALID_RESPONSE", "A KPI recommendation is invalid.");
    const existing = await db.queryDefinition.findFirst({
      where: { analysisJobId: job.id, recommendationId: recommendation.id },
    });
    if (existing) continue;
    await db.queryDefinition.create({
      data: {
        analysisJobId: job.id,
        recommendationId: recommendation.id,
        purpose: parsed.data.businessQuestion,
        sql: parsed.data.proposedSql,
        sqlHash: contentHash(parsed.data.proposedSql),
      },
    });
  }
  return success({
    nextStage: "VALIDATING_QUERIES" as const,
    progressPercent: STAGE_PROGRESS.VALIDATING_QUERIES,
  });
}

async function validateQueriesStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const configuration = env();
  const metadata = await metadataForJob(job.id);
  if (!metadata.ok) return metadata;
  const queries = await db.queryDefinition.findMany({
    where: { analysisJobId: job.id },
    orderBy: { createdAt: "asc" },
  });
  for (const query of queries) {
    let candidate = query.sql;
    let validation = validateGroundedReadOnlySql(
      candidate,
      metadata.data.context,
      configuration.QUERY_MAX_ROWS,
    );
    for (let attempt = 1; !validation.ok && attempt <= 2; attempt++) {
      const repaired = await generateCachedStructuredOutput(context, {
        requestId: crypto.randomUUID(),
        schemaName: "sql_repair",
        outputSchema: sqlRepairSchema,
        systemPrompt: GROUNDING_SYSTEM_PROMPT,
        userPrompt: metadataTaskPrompt(
          `Repair this ${metadata.data.context.dataSourceType === "ORACLE" ? "Oracle" : "MySQL"} SELECT query. ${metadata.data.context.dataSourceType === "ORACLE" ? "Use double-quoted approved identifiers and FETCH FIRST n ROWS ONLY; never use LIMIT. " : ""}Validation code: ${validation.error.code}. Validation message: ${validation.error.message}. Repair attempt ${attempt} of 2. Original query: ${candidate}`,
          JSON.stringify(metadata.data.context),
        ),
        promptVersion: `sql-repair-v1-attempt-${attempt}`,
        onProgress: createJobHeartbeatReporter(job),
      });
      if (!repaired.ok) return repaired;
      candidate = repaired.data.data.sql;
      validation = validateGroundedReadOnlySql(
        candidate,
        metadata.data.context,
        configuration.QUERY_MAX_ROWS,
      );
    }
    if (!validation.ok) {
      await db.queryDefinition.update({
        where: { id: query.id },
        data: {
          validationStatus: "INVALID",
          validationErrors: [
            { code: validation.error.code, message: validation.error.message },
          ],
        },
      });
      return validation;
    }
    await db.queryDefinition.update({
      where: { id: query.id },
      data: {
        sql: validation.data.sql,
        sqlHash: contentHash(validation.data.sql),
        validationStatus: "VALID",
        validationErrors: Prisma.JsonNull,
      },
    });
  }
  return success({
    nextStage: "EXECUTING_QUERIES" as const,
    progressPercent: STAGE_PROGRESS.EXECUTING_QUERIES,
  });
}

async function executeQueriesStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const queries = await db.queryDefinition.findMany({
    where: { analysisJobId: job.id, validationStatus: "VALID" },
    orderBy: { createdAt: "asc" },
  });
  if (!queries.length)
    return failure("QUERY_VALIDATION_FAILED", "No validated queries exist.");
  const connector = await getDataSourceConnector(context, job.dataSourceId);
  if (!connector.ok) return connector;
  try {
    for (const query of queries) {
      const existing = await db.queryExecution.findFirst({
        where: { queryDefinitionId: query.id, status: "SUCCEEDED" },
      });
      if (existing) continue;
      const result = await executeQueryDefinition(
        context,
        query.id,
        connector.data.connector,
      );
      if (!result.ok) return result;
    }
  } finally {
    await connector.data.connector.close();
  }
  return success({
    nextStage: "GENERATING_WIDGETS" as const,
    progressPercent: STAGE_PROGRESS.GENERATING_WIDGETS,
  });
}

function queryFieldMap(
  queries: Array<{ id: string; resultSchema: Prisma.JsonValue | null }>,
) {
  return new Map(
    queries.map((query) => {
      const fields = Array.isArray(query.resultSchema)
        ? query.resultSchema
            .map((field) =>
              field && typeof field === "object" && "name" in field
                ? String(field.name)
                : null,
            )
            .filter((field): field is string => Boolean(field))
        : [];
      return [query.id, new Set(fields)] as const;
    }),
  );
}

function fallbackWidgetsForQueries(
  queries: Array<{
    id: string;
    purpose: string;
    resultSchema: Prisma.JsonValue | null;
  }>,
  maxWidgets: number,
): DashboardWidgetDefinition[] {
  const fieldsByQuery = queryFieldMap(queries);
  return queries.slice(0, maxWidgets).map((query, index) => {
    const fields = [...(fieldsByQuery.get(query.id) ?? new Set<string>())];
    return {
      id: `fallback-query-${index + 1}`,
      type: "TABLE",
      title: query.purpose.slice(0, 120),
      description:
        "Validated query preview shown because an AI widget mapping could not be grounded.",
      businessQuestion: query.purpose,
      visualizationReason:
        "A table safely exposes only fields returned by the validated query.",
      priority: index === 0 ? "PRIMARY" : "MEDIUM",
      queryDefinitionId: query.id,
      layout: { x: 0, y: index * 4, width: 12, height: 4 },
      visualization: { palette: "BLUE", showLegend: false },
      dataMapping: { dimensions: fields.slice(0, 10), measures: [] },
      formatting: { displayFormat: "NUMBER", decimals: 0, compact: false },
      emptyStateMessage: "The validated query returned no rows.",
      limitations: [
        "Fallback table used because AI-generated widget fields were not present in the validated query result.",
      ],
    };
  });
}

async function generateWidgetsStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const configuration = env();
  const [metadata, schemaArtifact, kpiArtifact, queries] = await Promise.all([
    metadataForJob(job.id),
    latestArtifact(job.id, "SCHEMA_ANALYSIS"),
    latestArtifact(job.id, "KPI_RECOMMENDATIONS"),
    db.queryDefinition.findMany({ where: { analysisJobId: job.id } }),
  ]);
  if (!metadata.ok) return metadata;
  const kpis = kpiRecommendationsSchema(
    configuration.AI_MAX_KPI_RECOMMENDATIONS,
  ).safeParse(kpiArtifact?.payload);
  if (!kpis.success)
    return failure(
      "AI_INVALID_RESPONSE",
      "KPI recommendations are unavailable.",
    );
  const approvedKpiIds = new Set(
    kpis.data.recommendations.map((kpi) => kpi.id),
  );
  const queryIds = new Set(queries.map((query) => query.id));
  const planResponse = await generateCachedStructuredOutput(context, {
    requestId: crypto.randomUUID(),
    schemaName: "dashboard_plan",
    outputSchema: dashboardPlanSchema,
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    userPrompt: metadataTaskPrompt(
      `${DASHBOARD_DESIGN_PROMPT}\n\nChoose the closest dashboard template and create the complete structured dashboard plan before defining widgets. Copy KPI and query identifiers exactly from the provided input; never create a new identifier or propose a section that needs a query not present in the input. Use only approved metadata filter columns. Include a date-range filter when a grounded date column exists and relevant category filters when grounded category/status columns exist.`,
      JSON.stringify({
        templates: DASHBOARD_TEMPLATES,
        metadata: metadata.data.context,
        schemaAnalysis: schemaArtifact?.payload,
        kpis: kpis.data,
        queries: queries.map((query) => ({
          id: query.id,
          purpose: query.purpose,
          resultSchema: query.resultSchema,
        })),
      }),
    ),
    promptVersion: PROMPT_VERSIONS.dashboardPlan,
    onProgress: createJobHeartbeatReporter(job),
  });
  if (!planResponse.ok) return planResponse;
  const groundedPlan = validateDashboardPlanGrounding(
    planResponse.data.data,
    metadata.data.context,
    approvedKpiIds,
    queryIds,
  );
  if (!groundedPlan.ok) return groundedPlan;
  await persistArtifact({
    job,
    type: "DASHBOARD_PLAN",
    stage: "GENERATING_WIDGETS",
    payload: groundedPlan.data as Prisma.InputJsonValue,
    inputHash: planResponse.data.inputHash,
    promptVersion: planResponse.data.promptVersion,
    provider: planResponse.data.provider,
    model: planResponse.data.model,
    inputTokens: planResponse.data.usage?.inputTokens,
    outputTokens: planResponse.data.usage?.outputTokens,
  });
  const widgetContext = JSON.stringify({
    plan: groundedPlan.data,
    kpis: kpis.data,
    queries: queries.map((query) => ({
      id: query.id,
      purpose: query.purpose,
      resultSchema: query.resultSchema,
    })),
  });
  const generateWidgets = (feedback?: string) =>
    generateCachedStructuredOutput(context, {
      requestId: crypto.randomUUID(),
      schemaName: "dashboard_widgets",
      outputSchema: widgetDefinitionsSchema(configuration.AI_MAX_WIDGETS),
      systemPrompt: GROUNDING_SYSTEM_PROMPT,
      userPrompt: metadataTaskPrompt(
        `${DASHBOARD_DESIGN_PROMPT}\n\nCreate the accessible widget definitions for the approved plan. Map only fields present in each query result schema. For each applicable plan filter, add a widget filter binding whose field exists in that widget query result. Do not silently substitute visualization types.${feedback ? `\n\nThe previous widget definition failed validation. Correct every issue using exact result-schema field names: ${feedback}` : ""}`,
        widgetContext,
      ),
      promptVersion: feedback
        ? `${PROMPT_VERSIONS.widgetDefinitions}-quality-repair`
        : PROMPT_VERSIONS.widgetDefinitions,
      onProgress: createJobHeartbeatReporter(job),
    });
  const approvedFilters = new Map(
    groundedPlan.data.globalFilters.map((filter) => [
      filter.id,
      filter.control,
    ]),
  );
  const validateWidgets = (widgets: DashboardWidgetDefinition[]) =>
    validateWidgetGrounding(widgets, queryFieldMap(queries), approvedFilters);
  const groundFallbackWidgets = () => {
    const fallbackWidgets = fallbackWidgetsForQueries(
      queries,
      configuration.AI_MAX_WIDGETS,
    );
    return fallbackWidgets.length ? validateWidgets(fallbackWidgets) : null;
  };
  let widgetResponse = await generateWidgets();
  if (!widgetResponse.ok) return widgetResponse;
  let groundedWidgets = validateWidgets(widgetResponse.data.data.widgets);
  let usingFallbackWidgets = false;
  for (
    let repairAttempt = 1;
    !groundedWidgets.ok && repairAttempt <= 2;
    repairAttempt++
  ) {
    widgetResponse = await generateWidgets(
      `${groundedWidgets.error.message} Repair attempt ${repairAttempt} of 2.`,
    );
    if (!widgetResponse.ok) return widgetResponse;
    groundedWidgets = validateWidgets(widgetResponse.data.data.widgets);
  }
  if (!groundedWidgets.ok) {
    const fallback = groundFallbackWidgets();
    if (!fallback) return groundedWidgets;
    groundedWidgets = fallback;
    if (!groundedWidgets.ok) return groundedWidgets;
    usingFallbackWidgets = true;
  }
  const qualityOptions = {
    filtersAvailable: (() => {
      const analysis = businessSchemaAnalysisSchema.safeParse(
        schemaArtifact?.payload,
      );
      return analysis.success
        ? Boolean(
            analysis.data.dateColumns.length ||
            analysis.data.categoryColumns.length ||
            analysis.data.statusColumns.length,
          )
        : false;
    })(),
  };
  let quality = usingFallbackWidgets
    ? success(
        scoreDashboardQuality(
          groundedWidgets.data,
          groundedPlan.data,
          qualityOptions,
        ),
      )
    : validateDashboardQuality(
        groundedWidgets.data,
        groundedPlan.data,
        qualityOptions,
      );
  if (!quality.ok) {
    widgetResponse = await generateWidgets(
      String(quality.error.diagnostics?.qualityScore ?? quality.error.message),
    );
    if (!widgetResponse.ok) return widgetResponse;
    groundedWidgets = validateWidgets(widgetResponse.data.data.widgets);
    if (!groundedWidgets.ok) {
      const fallback = groundFallbackWidgets();
      if (!fallback) return groundedWidgets;
      groundedWidgets = fallback;
      usingFallbackWidgets = true;
    }
    if (!groundedWidgets.ok) return groundedWidgets;
    quality = usingFallbackWidgets
      ? success(
          scoreDashboardQuality(
            groundedWidgets.data,
            groundedPlan.data,
            qualityOptions,
          ),
        )
      : validateDashboardQuality(
          groundedWidgets.data,
          groundedPlan.data,
          qualityOptions,
        );
    if (!quality.ok) return quality;
  }
  const artifact = await persistArtifact({
    job,
    type: "WIDGET_DEFINITIONS",
    stage: "GENERATING_WIDGETS",
    payload: {
      widgets: groundedWidgets.data,
      quality: quality.data,
    } as Prisma.InputJsonValue,
    inputHash: widgetResponse.data.inputHash,
    promptVersion: widgetResponse.data.promptVersion,
    provider: widgetResponse.data.provider,
    model: widgetResponse.data.model,
    inputTokens: widgetResponse.data.usage?.inputTokens,
    outputTokens: widgetResponse.data.usage?.outputTokens,
  });
  for (const widget of groundedWidgets.data) {
    await db.analysisRecommendation.upsert({
      where: {
        analysisJobId_type_externalId_revision: {
          analysisJobId: job.id,
          type: "WIDGET",
          externalId: widget.id,
          revision: 1,
        },
      },
      update: {},
      create: {
        analysisJobId: job.id,
        artifactId: artifact.id,
        type: "WIDGET",
        externalId: widget.id,
        title: widget.title,
        description: widget.description,
        payload: widget as Prisma.InputJsonValue,
      },
    });
  }
  return success({
    nextStage: "GENERATING_INSIGHTS" as const,
    progressPercent: STAGE_PROGRESS.GENERATING_INSIGHTS,
  });
}

async function generateInsightsStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const configuration = env();
  const privacyPolicy = await getEffectiveAiPrivacyPolicy(
    context.organizationId,
  );
  const [widgetArtifact, queries] = await Promise.all([
    latestArtifact(job.id, "WIDGET_DEFINITIONS"),
    db.queryDefinition.findMany({
      where: { analysisJobId: job.id },
      include: {
        executions: {
          where: { status: "SUCCEEDED" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    }),
  ]);
  const widgets = widgetDefinitionsSchema(
    configuration.AI_MAX_WIDGETS,
  ).safeParse(widgetArtifact?.payload);
  if (!widgets.success)
    return failure(
      "AI_INVALID_RESPONSE",
      "Widget definitions are unavailable.",
    );
  let insights: { insights: unknown[] } = { insights: [] };
  let responseMetadata:
    | {
        inputHash: string;
        promptVersion: string;
        provider: string;
        model: string;
        usage?: { inputTokens?: number; outputTokens?: number };
      }
    | undefined;
  if (privacyPolicy.sendSampleData && configuration.AI_MAX_INSIGHTS > 0) {
    const queryResults = queries.map((query) => ({
      id: query.id,
      purpose: query.purpose,
      rows: Array.isArray(query.executions[0]?.previewRows)
        ? query.executions[0].previewRows.map((row) =>
            row && typeof row === "object" && !Array.isArray(row)
              ? sanitizeSampleRow(row as Record<string, unknown>, {
                  maskSensitiveData: privacyPolicy.maskSensitiveData,
                  maskingRules: privacyPolicy.maskingRules,
                  maxLength: configuration.AI_MAX_SAMPLE_CELL_LENGTH,
                })
              : {},
          )
        : [],
    }));
    const response = await generateCachedStructuredOutput(context, {
      requestId: crypto.randomUUID(),
      schemaName: "grounded_insights",
      outputSchema: generatedInsightsSchema(configuration.AI_MAX_INSIGHTS),
      systemPrompt: GROUNDING_SYSTEM_PROMPT,
      userPrompt: `Generate concise descriptive insights supported directly by these validated query previews. Do not predict or infer causation.\n\n${JSON.stringify(
        {
          widgets: widgets.data.widgets,
          queryResults,
        },
      )}`,
      promptVersion: PROMPT_VERSIONS.insights,
      onProgress: createJobHeartbeatReporter(job),
    });
    if (!response.ok) return response;
    insights = response.data.data;
    responseMetadata = response.data;
  }
  const parsedInsights = generatedInsightsSchema(
    configuration.AI_MAX_INSIGHTS,
  ).parse(insights);
  const grounded = validateInsightGrounding(
    parsedInsights.insights,
    new Set(widgets.data.widgets.map((widget) => widget.id)),
    new Set(queries.map((query) => query.id)),
  );
  if (!grounded.ok) return grounded;
  const payload = {
    insights: grounded.data,
    warnings: configuration.AI_SEND_SAMPLE_DATA
      ? []
      : [
          "AI result-data transmission is disabled, so generated insights were omitted.",
        ],
  };
  await persistArtifact({
    job,
    type: "GENERATED_INSIGHTS",
    stage: "GENERATING_INSIGHTS",
    payload: payload as Prisma.InputJsonValue,
    inputHash: responseMetadata?.inputHash ?? contentHash(payload),
    promptVersion: responseMetadata?.promptVersion,
    provider: responseMetadata?.provider,
    model: responseMetadata?.model,
    inputTokens: responseMetadata?.usage?.inputTokens,
    outputTokens: responseMetadata?.usage?.outputTokens,
  });
  return success({
    nextStage: "FINALIZING_DASHBOARD" as const,
    progressPercent: STAGE_PROGRESS.FINALIZING_DASHBOARD,
    status: "WAITING_FOR_APPROVAL" as const,
    resultSummary: {
      kpiCount: await db.analysisRecommendation.count({
        where: { analysisJobId: job.id, type: "KPI" },
      }),
      widgetCount: widgets.data.widgets.length,
      insightCount: grounded.data.length,
    },
  });
}

export const runAnalysisStage: AnalysisStageHandler = async (context, job) => {
  switch (job.currentStage) {
    case "PREPARING_METADATA":
      return prepareMetadataStage(context, job);
    case "ANALYZING_SCHEMA":
      return analyzeSchemaStage(context, job);
    case "IDENTIFYING_BUSINESS_ENTITIES":
      return validateEntitiesStage(context, job);
    case "RECOMMENDING_KPIS":
      return recommendKpisStage(context, job);
    case "GENERATING_QUERIES":
      return generateQueriesStage(context, job);
    case "VALIDATING_QUERIES":
      return validateQueriesStage(context, job);
    case "EXECUTING_QUERIES":
      return executeQueriesStage(context, job);
    case "GENERATING_WIDGETS":
      return generateWidgetsStage(context, job);
    case "GENERATING_INSIGHTS":
      return generateInsightsStage(context, job);
    case "FINALIZING_DASHBOARD":
      return success({
        nextStage: "FINALIZING_DASHBOARD",
        progressPercent: STAGE_PROGRESS.FINALIZING_DASHBOARD,
        status: "WAITING_FOR_APPROVAL",
      });
  }
};
