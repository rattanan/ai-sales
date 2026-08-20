import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import {
  type DashboardWidgetDefinition,
  dashboardWidgetDefinitionSchema,
  kpiRecommendationSchema,
  metadataContextSchema,
  recommendationDecisionSchema,
} from "@/schemas/analysis";
import { z } from "zod";
import { db } from "@/server/db";
import { failure, success } from "@/types/result";
import { env } from "@/schemas/env";
import { generateCachedStructuredOutput } from "@/server/ai/cached-provider";
import { GROUNDING_SYSTEM_PROMPT } from "@/server/ai/prompts";
import {
  validateKpiGrounding,
  validateWidgetGrounding,
} from "@/server/ai/grounding";
import {
  createValidatedQueryDefinition,
  executeQueryDefinition,
} from "./query-service";
import { createHash } from "node:crypto";

export async function updateRecommendationDecision(
  context: AuthorizationContext,
  input: unknown,
) {
  const parsed = recommendationDecisionSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Review the recommendation fields and try again.",
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  const recommendation = await db.analysisRecommendation.findFirst({
    where: {
      id: parsed.data.recommendationId,
      analysisJob: { workspaceId: context.workspaceId },
    },
    include: { analysisJob: { select: { status: true } } },
  });
  if (!recommendation) return failure("NOT_FOUND", "Recommendation not found.");
  if (recommendation.analysisJob.status !== "WAITING_FOR_APPROVAL")
    return failure(
      "CONFLICT",
      "Recommendations can only be changed during human review.",
    );
  let payload: Prisma.InputJsonValue;
  if (recommendation.type === "KPI") {
    const recommendationPayload = kpiRecommendationSchema.safeParse(
      recommendation.payload,
    );
    if (!recommendationPayload.success)
      return failure(
        "AI_INVALID_RESPONSE",
        "The KPI recommendation is invalid.",
      );
    payload = {
      ...recommendationPayload.data,
      name: parsed.data.title,
      description: parsed.data.description ?? "",
    } as Prisma.InputJsonValue;
  } else {
    const recommendationPayload = dashboardWidgetDefinitionSchema.safeParse(
      recommendation.payload,
    );
    if (!recommendationPayload.success)
      return failure(
        "AI_INVALID_RESPONSE",
        "The widget recommendation is invalid.",
      );
    const editedWidget = dashboardWidgetDefinitionSchema.safeParse({
      ...recommendationPayload.data,
      type:
        parsed.data.decision === "APPROVED"
          ? (parsed.data.widgetType ?? recommendationPayload.data.type)
          : recommendationPayload.data.type,
      title: parsed.data.title,
      description: parsed.data.description,
      thresholds:
        parsed.data.decision === "APPROVED" && parsed.data.gaugeTarget
          ? [
              {
                value: parsed.data.gaugeTarget,
                operator: "GTE",
                tone: "POSITIVE",
                label: "Target",
              },
            ]
          : recommendationPayload.data.thresholds,
    });
    if (!editedWidget.success)
      return failure(
        "VALIDATION_ERROR",
        "The selected chart type is incompatible with this widget's validated data mapping.",
        { fieldErrors: editedWidget.error.flatten().fieldErrors },
      );
    payload = editedWidget.data as Prisma.InputJsonValue;
  }
  await db.$transaction([
    db.analysisRecommendation.update({
      where: { id: recommendation.id },
      data: {
        status: parsed.data.decision,
        title: parsed.data.title,
        description: parsed.data.description,
        payload,
        reviewedById: context.userId,
        reviewedAt: new Date(),
        decisionNote: parsed.data.decisionNote,
      },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action:
          parsed.data.decision === "APPROVED"
            ? "ANALYSIS_RECOMMENDATION_APPROVED"
            : "ANALYSIS_RECOMMENDATION_REJECTED",
        entityType: "AnalysisRecommendation",
        entityId: recommendation.id,
        metadata: { type: recommendation.type },
      },
    }),
  ]);
  return success({
    id: recommendation.id,
    status: parsed.data.decision,
    title: parsed.data.title,
    description: parsed.data.description ?? null,
    widgetType:
      recommendation.type === "WIDGET" &&
      payload &&
      typeof payload === "object" &&
      !Array.isArray(payload) &&
      "type" in payload
        ? String(payload.type)
        : null,
  });
}

export async function approveAnalysisRecommendations(
  context: AuthorizationContext,
  input: { analysisJobId: string; recommendationIds?: string[] },
) {
  const job = await db.analysisJob.findFirst({
    where: { id: input.analysisJobId, workspaceId: context.workspaceId },
    select: {
      status: true,
      recommendations: {
        where: { status: { not: "SUPERSEDED" } },
      },
    },
  });
  if (!job) return failure("NOT_FOUND", "Analysis job not found.");
  if (job.status !== "WAITING_FOR_APPROVAL")
    return failure(
      "CONFLICT",
      "Recommendations can only be changed during human review.",
    );

  const requestedIds = input.recommendationIds?.length
    ? new Set(input.recommendationIds)
    : null;
  const recommendations = requestedIds
    ? job.recommendations.filter((item) => requestedIds.has(item.id))
    : job.recommendations.filter((item) => item.status !== "APPROVED");
  if (requestedIds && recommendations.length !== requestedIds.size)
    return failure(
      "VALIDATION_ERROR",
      "One or more selected recommendations are unavailable.",
    );
  if (!recommendations.length)
    return success({ approvedCount: 0, recommendationIds: [] });

  for (const recommendation of recommendations) {
    const valid =
      recommendation.type === "KPI"
        ? kpiRecommendationSchema.safeParse(recommendation.payload).success
        : dashboardWidgetDefinitionSchema.safeParse(recommendation.payload)
            .success;
    if (!valid)
      return failure(
        "AI_INVALID_RESPONSE",
        `The ${recommendation.type.toLowerCase()} recommendation “${recommendation.title}” is invalid.`,
      );
  }

  const reviewedAt = new Date();
  await db.$transaction(
    recommendations.flatMap((recommendation) => [
      db.analysisRecommendation.update({
        where: { id: recommendation.id },
        data: {
          status: "APPROVED",
          reviewedById: context.userId,
          reviewedAt,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "ANALYSIS_RECOMMENDATION_APPROVED",
          entityType: "AnalysisRecommendation",
          entityId: recommendation.id,
          metadata: { type: recommendation.type, bulk: true },
        },
      }),
    ]),
  );
  return success({
    approvedCount: recommendations.length,
    recommendationIds: recommendations.map((item) => item.id),
  });
}

export async function finalizeAnalysisDashboard(
  context: AuthorizationContext,
  analysisJobId: string,
) {
  const job = await db.analysisJob.findFirst({
    where: { id: analysisJobId, workspaceId: context.workspaceId },
    include: {
      dashboard: { include: { versions: { select: { version: true } } } },
      recommendations: true,
      queryDefinitions: {
        include: {
          recommendation: true,
          executions: {
            where: { status: "SUCCEEDED" },
            orderBy: { createdAt: "desc" },
            take: 1,
          },
        },
      },
      artifacts: true,
    },
  });
  if (!job) return failure("NOT_FOUND", "Analysis job not found.");
  if (job.status !== "WAITING_FOR_APPROVAL")
    return failure(
      "CONFLICT",
      "Complete analysis and human review before finalizing the dashboard.",
    );
  const approvedKpis = job.recommendations.filter(
    (recommendation) =>
      recommendation.type === "KPI" && recommendation.status === "APPROVED",
  );
  const approvedWidgets = job.recommendations.filter(
    (recommendation) =>
      recommendation.type === "WIDGET" && recommendation.status === "APPROVED",
  );
  if (!approvedKpis.length || !approvedWidgets.length)
    return failure(
      "VALIDATION_ERROR",
      "Approve at least one KPI and one widget before finalizing.",
    );
  const approvedKpiRecommendationIds = new Set(
    approvedKpis.map((recommendation) => recommendation.id),
  );
  const queryById = new Map(
    job.queryDefinitions.map((query) => [query.id, query]),
  );
  const widgets: DashboardWidgetDefinition[] = [];
  for (const recommendation of approvedWidgets) {
    const parsed = dashboardWidgetDefinitionSchema.safeParse(
      recommendation.payload,
    );
    if (!parsed.success)
      return failure("AI_INVALID_RESPONSE", "An approved widget is invalid.");
    if (parsed.data.queryDefinitionId) {
      const query = queryById.get(parsed.data.queryDefinitionId);
      if (
        !query ||
        !query.recommendationId ||
        !approvedKpiRecommendationIds.has(query.recommendationId) ||
        !query.executions.length
      )
        return failure(
          "VALIDATION_ERROR",
          "Every approved data widget must use an approved KPI query with a successful preview.",
        );
    }
    widgets.push(parsed.data);
  }
  widgets.sort(
    (left, right) =>
      left.layout.y - right.layout.y || left.layout.x - right.layout.x,
  );
  const nextVersion =
    Math.max(0, ...job.dashboard.versions.map((version) => version.version)) +
    1;
  const plan = job.artifacts.find(
    (artifact) => artifact.type === "DASHBOARD_PLAN",
  );
  const insights = job.artifacts.find(
    (artifact) => artifact.type === "GENERATED_INSIGHTS",
  );
  const snapshot = {
    version: 1,
    analysisJobId: job.id,
    analysisRequest: job.requestSnapshot,
    dashboardPlan: plan?.payload ?? null,
    approvedKpis: approvedKpis.map((recommendation) => recommendation.payload),
    approvedWidgets: widgets,
    insights: insights?.payload ?? null,
    queries: job.queryDefinitions
      .filter((query) =>
        query.recommendationId
          ? approvedKpiRecommendationIds.has(query.recommendationId)
          : false,
      )
      .map((query) => ({
        id: query.id,
        purpose: query.purpose,
        sql: query.sql,
        sqlHash: query.sqlHash,
        resultSchema: query.resultSchema,
        preview: query.executions[0]?.previewRows ?? [],
      })),
  } as Prisma.InputJsonValue;

  const version = await db.$transaction(async (transaction) => {
    await transaction.dashboardWidget.deleteMany({
      where: { dashboardId: job.dashboardId },
    });
    for (const [position, widget] of widgets.entries()) {
      await transaction.dashboardWidget.create({
        data: {
          dashboardId: job.dashboardId,
          type: widget.type,
          title: widget.title,
          position,
          config: {
            version: 1,
            definition: widget,
          },
        },
      });
    }
    const createdVersion = await transaction.dashboardVersion.create({
      data: {
        dashboardId: job.dashboardId,
        version: nextVersion,
        createdById: context.userId,
        snapshot,
      },
    });
    await transaction.analysisJob.update({
      where: { id: job.id },
      data: {
        status: "COMPLETED",
        progressPercent: 100,
        completedAt: new Date(),
        finalVersionId: createdVersion.id,
      },
    });
    await transaction.dashboard.update({
      where: { id: job.dashboardId },
      data: { status: "GENERATED" },
    });
    await transaction.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "ANALYSIS_DASHBOARD_FINALIZED",
        entityType: "DashboardVersion",
        entityId: createdVersion.id,
        requestId: job.requestId,
        metadata: {
          analysisJobId: job.id,
          dashboardId: job.dashboardId,
          version: nextVersion,
          kpis: approvedKpis.length,
          widgets: widgets.length,
        },
      },
    });
    return createdVersion;
  });
  return success({
    dashboardId: job.dashboardId,
    versionId: version.id,
    version: version.version,
  });
}

export async function regenerateAnalysisRecommendation(
  context: AuthorizationContext,
  recommendationId: string,
) {
  const recommendation = await db.analysisRecommendation.findFirst({
    where: {
      id: recommendationId,
      analysisJob: { workspaceId: context.workspaceId },
    },
    include: {
      analysisJob: {
        include: {
          artifacts: true,
          queryDefinitions: true,
        },
      },
    },
  });
  if (!recommendation) return failure("NOT_FOUND", "Recommendation not found.");
  if (recommendation.analysisJob.status !== "WAITING_FOR_APPROVAL")
    return failure(
      "CONFLICT",
      "Recommendations can only be regenerated during human review.",
    );
  const configuration = env();
  const metadataArtifact = recommendation.analysisJob.artifacts.find(
    (artifact) => artifact.type === "METADATA_CONTEXT",
  );
  const metadata = metadataContextSchema.safeParse(metadataArtifact?.payload);
  if (!metadata.success)
    return failure(
      "ANALYSIS_SCOPE_INVALID",
      "Analysis metadata is unavailable.",
    );
  const revision =
    Math.max(
      0,
      ...(
        await db.analysisRecommendation.findMany({
          where: {
            analysisJobId: recommendation.analysisJobId,
            type: recommendation.type,
            externalId: recommendation.externalId,
          },
          select: { revision: true },
        })
      ).map((item) => item.revision),
    ) + 1;
  const requestId = crypto.randomUUID();
  const artifactType =
    recommendation.type === "KPI"
      ? "KPI_RECOMMENDATIONS"
      : "WIDGET_DEFINITIONS";
  const artifactRevision =
    Math.max(
      0,
      ...recommendation.analysisJob.artifacts
        .filter((artifact) => artifact.type === artifactType)
        .map((artifact) => artifact.revision),
    ) + 1;

  if (recommendation.type === "KPI") {
    const original = kpiRecommendationSchema.safeParse(recommendation.payload);
    if (!original.success)
      return failure("AI_INVALID_RESPONSE", "The original KPI is invalid.");
    const response = await generateCachedStructuredOutput(context, {
      requestId,
      schemaName: "regenerated_kpi",
      outputSchema: z.object({ recommendation: kpiRecommendationSchema }),
      systemPrompt: GROUNDING_SYSTEM_PROMPT,
      userPrompt: `Regenerate this single KPI recommendation with a materially improved but still grounded definition. Preserve its id. Return one recommendation only.\n\n${JSON.stringify(
        { metadata: metadata.data, original: original.data },
      )}`,
      promptVersion: `kpi-regeneration-v1-revision-${revision}`,
    });
    if (!response.ok) return response;
    const candidate = {
      ...response.data.data.recommendation,
      id: recommendation.externalId,
    };
    const grounded = validateKpiGrounding(
      candidate,
      metadata.data,
      configuration.QUERY_MAX_ROWS,
    );
    if (!grounded.ok) return grounded;
    const artifact = await db.analysisArtifact.create({
      data: {
        analysisJobId: recommendation.analysisJobId,
        type: "KPI_RECOMMENDATIONS",
        stage: "RECOMMENDING_KPIS",
        revision: artifactRevision,
        promptVersion: response.data.promptVersion,
        inputHash: response.data.inputHash,
        contentHash: createHash("sha256")
          .update(JSON.stringify(grounded.data))
          .digest("hex"),
        provider: response.data.provider,
        model: response.data.model,
        inputTokens: response.data.usage?.inputTokens,
        outputTokens: response.data.usage?.outputTokens,
        payload: { recommendations: [grounded.data] },
      },
    });
    const created = await db.$transaction(async (transaction) => {
      await transaction.analysisRecommendation.update({
        where: { id: recommendation.id },
        data: { status: "SUPERSEDED" },
      });
      return transaction.analysisRecommendation.create({
        data: {
          analysisJobId: recommendation.analysisJobId,
          artifactId: artifact.id,
          type: "KPI",
          externalId: recommendation.externalId,
          title: grounded.data.name,
          description: grounded.data.description,
          payload: grounded.data as Prisma.InputJsonValue,
          revision,
        },
      });
    });
    const query = await createValidatedQueryDefinition(context, {
      analysisJobId: recommendation.analysisJobId,
      recommendationId: created.id,
      purpose: grounded.data.businessQuestion,
      sql: grounded.data.proposedSql,
    });
    if (!query.ok) return query;
    const execution = await executeQueryDefinition(context, query.data.id);
    if (!execution.ok) return execution;
    await recordRegenerationAudit(context, created.id, "KPI", revision);
    return success({ id: created.id, type: "KPI" as const, revision });
  }

  const original = dashboardWidgetDefinitionSchema.safeParse(
    recommendation.payload,
  );
  if (!original.success)
    return failure("AI_INVALID_RESPONSE", "The original widget is invalid.");
  const queries = recommendation.analysisJob.queryDefinitions;
  const response = await generateCachedStructuredOutput(context, {
    requestId,
    schemaName: "regenerated_widget",
    outputSchema: z.object({ widget: dashboardWidgetDefinitionSchema }),
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    userPrompt: `Regenerate this single widget with a clearer visualization while preserving its id and using only the supplied query identifiers and result fields.\n\n${JSON.stringify(
      {
        original: original.data,
        queries: queries.map((query) => ({
          id: query.id,
          purpose: query.purpose,
          resultSchema: query.resultSchema,
        })),
      },
    )}`,
    promptVersion: `widget-regeneration-v1-revision-${revision}`,
  });
  if (!response.ok) return response;
  const candidate = {
    ...response.data.data.widget,
    id: recommendation.externalId,
  };
  const queryFields = new Map(
    queries.map((query) => [
      query.id,
      new Set(
        Array.isArray(query.resultSchema)
          ? query.resultSchema
              .map((field) =>
                field && typeof field === "object" && "name" in field
                  ? String(field.name)
                  : null,
              )
              .filter((field): field is string => Boolean(field))
          : [],
      ),
    ]),
  );
  const grounded = validateWidgetGrounding([candidate], queryFields);
  if (!grounded.ok) return grounded;
  const widget = grounded.data[0];
  const artifact = await db.analysisArtifact.create({
    data: {
      analysisJobId: recommendation.analysisJobId,
      type: "WIDGET_DEFINITIONS",
      stage: "GENERATING_WIDGETS",
      revision: artifactRevision,
      promptVersion: response.data.promptVersion,
      inputHash: response.data.inputHash,
      contentHash: createHash("sha256")
        .update(JSON.stringify(widget))
        .digest("hex"),
      provider: response.data.provider,
      model: response.data.model,
      inputTokens: response.data.usage?.inputTokens,
      outputTokens: response.data.usage?.outputTokens,
      payload: { widgets: [widget] },
    },
  });
  const created = await db.$transaction(async (transaction) => {
    await transaction.analysisRecommendation.update({
      where: { id: recommendation.id },
      data: { status: "SUPERSEDED" },
    });
    return transaction.analysisRecommendation.create({
      data: {
        analysisJobId: recommendation.analysisJobId,
        artifactId: artifact.id,
        type: "WIDGET",
        externalId: recommendation.externalId,
        title: widget.title,
        description: widget.description,
        payload: widget as Prisma.InputJsonValue,
        revision,
      },
    });
  });
  await recordRegenerationAudit(context, created.id, "WIDGET", revision);
  return success({ id: created.id, type: "WIDGET" as const, revision });
}

async function recordRegenerationAudit(
  context: AuthorizationContext,
  entityId: string,
  type: "KPI" | "WIDGET",
  revision: number,
) {
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "ANALYSIS_RECOMMENDATION_REGENERATED",
      entityType: "AnalysisRecommendation",
      entityId,
      metadata: { type, revision },
    },
  });
}
