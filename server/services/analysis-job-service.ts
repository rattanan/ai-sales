import type { AnalysisJob, Prisma } from "@/generated/prisma/client";
import type {
  AnalysisJobStatus,
  AnalysisStage,
} from "@/generated/prisma/enums";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { PROMPT_VERSIONS } from "@/server/ai/prompts";
import { failure, success, type AppResult } from "@/types/result";
import { buildMetadataContextForDashboard } from "./metadata-context";
import { logger } from "./logger";
import { canStartDashboardAnalysis } from "./dashboard-analysis-state";
import { getEffectiveAiPrivacyPolicy } from "./privacy-policy";

const STAGE_ORDER: AnalysisStage[] = [
  "PREPARING_METADATA",
  "ANALYZING_SCHEMA",
  "IDENTIFYING_BUSINESS_ENTITIES",
  "RECOMMENDING_KPIS",
  "GENERATING_QUERIES",
  "VALIDATING_QUERIES",
  "EXECUTING_QUERIES",
  "GENERATING_WIDGETS",
  "GENERATING_INSIGHTS",
  "FINALIZING_DASHBOARD",
];

export const STAGE_PROGRESS: Record<AnalysisStage, number> = {
  PREPARING_METADATA: 5,
  ANALYZING_SCHEMA: 15,
  IDENTIFYING_BUSINESS_ENTITIES: 25,
  RECOMMENDING_KPIS: 35,
  GENERATING_QUERIES: 45,
  VALIDATING_QUERIES: 55,
  EXECUTING_QUERIES: 65,
  GENERATING_WIDGETS: 75,
  GENERATING_INSIGHTS: 85,
  FINALIZING_DASHBOARD: 95,
};

export function nextAnalysisStage(stage: AnalysisStage) {
  const index = STAGE_ORDER.indexOf(stage);
  return STAGE_ORDER[Math.min(index + 1, STAGE_ORDER.length - 1)];
}

export type AnalysisStageResult = {
  nextStage: AnalysisStage;
  progressPercent: number;
  status?: AnalysisJobStatus;
  resultSummary?: Prisma.InputJsonValue;
};

export type AnalysisStageHandler = (
  context: AuthorizationContext,
  job: AnalysisJob,
) => Promise<AppResult<AnalysisStageResult>>;

export function analysisJobSummary(job: {
  id: string;
  dashboardId: string;
  status: AnalysisJobStatus;
  currentStage: AnalysisStage;
  progressPercent: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastHeartbeatAt: Date | null;
  updatedAt: Date;
}) {
  return {
    id: job.id,
    dashboardId: job.dashboardId,
    status: job.status,
    currentStage: job.currentStage,
    progressPercent: job.progressPercent,
    errorCode: job.errorCode,
    errorMessage: job.errorMessage,
    lastHeartbeatAt: job.lastHeartbeatAt?.toISOString() ?? null,
    updatedAt: job.updatedAt.toISOString(),
  };
}

export async function createAnalysisJob(
  context: AuthorizationContext,
  dashboardId: string,
) {
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId: context.workspaceId },
    include: {
      dataSources: {
        include: {
          dataSource: {
            include: {
              schemas: {
                include: { tables: { where: { selected: true } } },
              },
            },
          },
        },
      },
      analysisJobs: {
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1,
        select: { requestSnapshot: true },
      },
    },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");
  if (dashboard.status === "ANALYZING") {
    const existing = await db.analysisJob.findFirst({
      where: {
        dashboardId: dashboard.id,
        workspaceId: context.workspaceId,
        status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL", "FAILED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (existing) return success(analysisJobSummary(existing));
    return failure(
      "CONFLICT",
      "This dashboard is already in analysis mode and cannot start another analysis.",
    );
  }
  const isReanalysis = dashboard.status === "GENERATED";
  if (
    !canStartDashboardAnalysis(
      dashboard.status,
      dashboard,
      dashboard.analysisJobs[0]?.requestSnapshot,
    )
  )
    return failure(
      "CONFLICT",
      dashboard.status === "GENERATED"
        ? "Update the dashboard objective before starting another analysis."
        : "This dashboard cannot start analysis in its current state.",
    );
  if (!dashboard.businessObjective)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Complete the dashboard objective before analysis.",
    );
  if (dashboard.dataSources.length !== 1)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Phase 1 analysis requires exactly one data source.",
    );
  const source = dashboard.dataSources[0].dataSource;
  if (source.type !== "MYSQL" && source.type !== "ORACLE")
    return failure(
      "CONNECTOR_NOT_IMPLEMENTED",
      "Phase 1 live analysis supports MySQL and Oracle data sources.",
    );
  if (source.status !== "CONNECTED")
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Test the database connection successfully before analysis.",
    );
  let selectedTables = source.schemas.flatMap((schema) =>
    schema.tables.map((table) => ({
      id: table.id,
      name: `${schema.name}.${table.name}`,
    })),
  );
  const autoPrioritizeTables =
    source.type === "ORACLE" &&
    (source.connectionOptions as { autoPrioritizeTables?: boolean } | null)
      ?.autoPrioritizeTables !== false;
  if (!selectedTables.length && autoPrioritizeTables) {
    await db.dataSourceTable.updateMany({
      where: { schema: { dataSourceId: source.id } },
      data: { selected: true },
    });
    const discoveredTables = await db.dataSourceTable.findMany({
      where: { schema: { dataSourceId: source.id } },
      include: { schema: { select: { name: true } } },
      orderBy: [{ schema: { name: "asc" } }, { name: "asc" }],
    });
    selectedTables = discoveredTables.map((table) => ({
      id: table.id,
      name: `${table.schema.name}.${table.name}`,
    }));
  }
  if (!selectedTables.length)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Select at least one discovered table before analysis.",
    );
  const configuration = env();
  const privacyPolicy = await getEffectiveAiPrivacyPolicy(
    context.organizationId,
  );
  const requestId = crypto.randomUUID();
  const requestSnapshot = {
    version: 1,
    dashboard: {
      id: dashboard.id,
      name: dashboard.name,
      businessArea: dashboard.businessArea,
      businessObjective: dashboard.businessObjective,
      businessQuestions: dashboard.businessQuestions,
      desiredKpis: dashboard.desiredKpis,
      targetUsers: dashboard.targetUsers,
      reportingPeriod: dashboard.reportingPeriod,
      importantFilters: dashboard.importantFilters,
      layoutStyle: dashboard.layoutStyle,
      visualStyle: dashboard.visualStyle,
      visualTheme: dashboard.visualTheme,
    },
    dataSource: {
      id: source.id,
      type: source.type,
      selectedTables,
    },
    aiPolicy: {
      provider: configuration.AI_PROVIDER,
      model: configuration.AI_MODEL ?? null,
      sendSampleData: privacyPolicy.sendSampleData,
      maskSensitiveData: privacyPolicy.maskSensitiveData,
      limits: {
        tables: configuration.AI_MAX_TABLES,
        columnsPerTable: configuration.AI_MAX_COLUMNS_PER_TABLE,
        sampleRowsPerTable: configuration.AI_SAMPLE_ROWS_PER_TABLE,
        kpis: configuration.AI_MAX_KPI_RECOMMENDATIONS,
        widgets: configuration.AI_MAX_WIDGETS,
        insights: configuration.AI_MAX_INSIGHTS,
      },
      promptVersions: PROMPT_VERSIONS,
    },
  } satisfies Prisma.InputJsonValue;
  const job = await db.$transaction(async (transaction) => {
    const created = await transaction.analysisJob.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        dashboardId: dashboard.id,
        dataSourceId: source.id,
        requestedById: context.userId,
        requestId,
        requestSnapshot,
      },
    });
    await transaction.dashboard.update({
      where: { id: dashboard.id },
      data: { status: "ANALYZING" },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "ANALYSIS_JOB_CREATED",
        entityType: "AnalysisJob",
        entityId: created.id,
        requestId,
        metadata: {
          dashboardId: dashboard.id,
          dataSourceId: source.id,
          selectedTableCount: selectedTables.length,
          reanalysis: isReanalysis,
        },
      },
    });
    return created;
  });
  return success(analysisJobSummary(job));
}

export async function prepareMetadataStage(
  context: AuthorizationContext,
  job: AnalysisJob,
) {
  const metadata = await buildMetadataContextForDashboard(
    context,
    job.dashboardId,
  );
  if (!metadata.ok) return metadata;
  await db.analysisArtifact.upsert({
    where: {
      analysisJobId_type_revision: {
        analysisJobId: job.id,
        type: "METADATA_CONTEXT",
        revision: 1,
      },
    },
    update: {},
    create: {
      analysisJobId: job.id,
      type: "METADATA_CONTEXT",
      stage: "PREPARING_METADATA",
      revision: 1,
      inputHash: metadata.data.hash,
      contentHash: metadata.data.hash,
      payload: metadata.data.context as Prisma.InputJsonValue,
    },
  });
  return success({
    nextStage: "ANALYZING_SCHEMA" as const,
    progressPercent: STAGE_PROGRESS.ANALYZING_SCHEMA,
  });
}

export async function advanceAnalysisJob(
  context: AuthorizationContext,
  analysisJobId: string,
  handler: AnalysisStageHandler,
) {
  const job = await db.analysisJob.findFirst({
    where: { id: analysisJobId, workspaceId: context.workspaceId },
  });
  if (!job) return failure("NOT_FOUND", "Analysis job not found.");
  if (["COMPLETED", "CANCELLED", "WAITING_FOR_APPROVAL"].includes(job.status))
    return success(analysisJobSummary(job));
  if (job.status === "FAILED")
    return failure(
      "CONFLICT",
      "Retry the failed analysis job before advancing it.",
    );

  const staleBefore = new Date(Date.now() - 5 * 60_000);
  const claimedVersion = job.runVersion + 1;
  const claimed = await db.analysisJob.updateMany({
    where: {
      id: job.id,
      runVersion: job.runVersion,
      OR: [
        { status: "QUEUED" },
        { status: "RUNNING", lastHeartbeatAt: null },
        { status: "RUNNING", lastHeartbeatAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "RUNNING",
      runVersion: claimedVersion,
      startedAt: job.startedAt ?? new Date(),
      lastHeartbeatAt: new Date(),
      errorCode: null,
      errorMessage: null,
    },
  });
  if (!claimed.count)
    return failure(
      "CONFLICT",
      "This analysis stage is already running. Wait for it to finish.",
    );

  const claimedJob = {
    ...job,
    runVersion: claimedVersion,
    status: "RUNNING" as const,
  };
  let result: AppResult<AnalysisStageResult>;
  try {
    result = await handler(context, claimedJob);
  } catch (error) {
    const requestId = crypto.randomUUID();
    logger.error("Analysis stage failed unexpectedly", {
      requestId,
      analysisJobId: job.id,
      stage: job.currentStage,
      error,
    });
    result = failure(
      "INTERNAL_ERROR",
      "The analysis stage could not be completed.",
      { requestId },
    );
  }
  if (!result.ok) {
    await db.$transaction([
      db.analysisJob.updateMany({
        where: { id: job.id, runVersion: claimedVersion },
        data: {
          status: "FAILED",
          failedAt: new Date(),
          lastHeartbeatAt: null,
          errorCode: result.error.code,
          errorMessage: result.error.message,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "ANALYSIS_STAGE_FAILED",
          entityType: "AnalysisJob",
          entityId: job.id,
          outcome: "FAILURE",
          requestId: result.error.requestId,
          metadata: {
            stage: job.currentStage,
            code: result.error.code,
            provider: env().AI_PROVIDER,
            model: env().AI_MODEL ?? null,
            diagnostics: result.error.diagnostics ?? {},
          },
        },
      }),
    ]);
    return result;
  }
  const applied = await db.$transaction(async (transaction) => {
    const update = await transaction.analysisJob.updateMany({
      where: { id: job.id, runVersion: claimedVersion, status: "RUNNING" },
      data: {
        currentStage: result.data.nextStage,
        progressPercent: result.data.progressPercent,
        status: result.data.status ?? "RUNNING",
        resultSummary: result.data.resultSummary,
        lastHeartbeatAt: null,
      },
    });
    if (update.count)
      await transaction.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "ANALYSIS_STAGE_COMPLETED",
          entityType: "AnalysisJob",
          entityId: job.id,
          requestId: job.requestId,
          metadata: {
            completedStage: job.currentStage,
            nextStage: result.data.nextStage,
            progressPercent: result.data.progressPercent,
          },
        },
      });
    return update;
  });
  if (!applied.count)
    return failure(
      "CONFLICT",
      "The analysis job changed while this stage was running.",
    );
  const updated = await db.analysisJob.findUniqueOrThrow({
    where: { id: job.id },
  });
  return success(analysisJobSummary(updated));
}

export async function retryAnalysisJob(
  context: AuthorizationContext,
  analysisJobId: string,
) {
  const failedJob = await db.analysisJob.findFirst({
    where: {
      id: analysisJobId,
      workspaceId: context.workspaceId,
      status: "FAILED",
    },
    select: { id: true, errorCode: true },
  });
  if (!failedJob)
    return failure("CONFLICT", "Only a failed analysis job can be retried.");
  const rebuildMetadata = [
    "AI_PROVIDER_ERROR",
    "ANALYSIS_SCOPE_INVALID",
    "AI_INVALID_RESPONSE",
  ].includes(failedJob.errorCode ?? "");
  await db.$transaction(async (transaction) => {
    if (rebuildMetadata) {
      await transaction.queryDefinition.deleteMany({
        where: { analysisJobId: failedJob.id },
      });
      await transaction.analysisRecommendation.deleteMany({
        where: { analysisJobId: failedJob.id },
      });
      await transaction.analysisArtifact.deleteMany({
        where: { analysisJobId: failedJob.id },
      });
    }
    await transaction.analysisJob.update({
      where: { id: failedJob.id },
      data: {
        status: "QUEUED",
        failedAt: null,
        errorCode: null,
        errorMessage: null,
        lastHeartbeatAt: null,
        ...(rebuildMetadata
          ? {
              currentStage: "PREPARING_METADATA",
              progressPercent: STAGE_PROGRESS.PREPARING_METADATA,
            }
          : {}),
      },
    });
  });
  const job = await db.analysisJob.findUniqueOrThrow({
    where: { id: analysisJobId },
  });
  return success(analysisJobSummary(job));
}

export async function cancelAnalysisJob(
  context: AuthorizationContext,
  analysisJobId: string,
) {
  const updated = await db.analysisJob.updateMany({
    where: {
      id: analysisJobId,
      workspaceId: context.workspaceId,
      status: { in: ["QUEUED", "RUNNING"] },
    },
    data: { status: "CANCELLED", lastHeartbeatAt: null },
  });
  if (!updated.count)
    return failure("CONFLICT", "This analysis job cannot be cancelled.");
  const job = await db.analysisJob.findUniqueOrThrow({
    where: { id: analysisJobId },
  });
  return success(analysisJobSummary(job));
}
