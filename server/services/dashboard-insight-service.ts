import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireDashboardAccess } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  dashboardWidgetDefinitionSchema,
  generatedInsightsSchema,
} from "@/schemas/analysis";
import type { z } from "zod";
import { env } from "@/schemas/env";
import { generateCachedStructuredOutput } from "@/server/ai/cached-provider";
import { GROUNDING_SYSTEM_PROMPT } from "@/server/ai/prompts";
import { validateInsightGrounding } from "@/server/ai/grounding";
import { sanitizeSampleRow } from "./sensitive-data";
import { failure, success } from "@/types/result";
import { insightDisplaySchema } from "@/schemas/dashboard-insights";
import { getEffectiveAiPrivacyPolicy } from "./privacy-policy";

type DisplayInsight = z.infer<typeof insightDisplaySchema>;

function dateValue(value: unknown) {
  const time = new Date(String(value ?? "")).getTime();
  return Number.isFinite(time) ? time : null;
}

function applyFilters(
  rows: Record<string, unknown>[],
  bindings: Array<{ id: string; control: string; field: string }> | undefined,
  filters: Record<string, string[]>,
) {
  if (!bindings?.length) return rows;
  return rows.filter((row) =>
    bindings.every((binding) => {
      if (binding.control === "DATE_RANGE") {
        const value = dateValue(row[binding.field]);
        const from = filters[`${binding.id}:from`]?.[0];
        const to = filters[`${binding.id}:to`]?.[0];
        if (value == null) return !from && !to;
        return (
          (!from || value >= new Date(`${from}T00:00:00`).getTime()) &&
          (!to || value <= new Date(`${to}T23:59:59.999`).getTime())
        );
      }
      const selected = filters[binding.id] ?? [];
      return !selected.length || selected.includes(String(row[binding.field]));
    }),
  );
}

export async function analyzeFilteredDashboardInsights(
  context: AuthorizationContext,
  dashboardId: string,
  filters: Record<string, string[]>,
) {
  await requireDashboardAccess(context, dashboardId, "view");
  const configuration = env();
  const privacyPolicy = await getEffectiveAiPrivacyPolicy(
    context.organizationId,
  );
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId: context.workspaceId },
    include: {
      widgets: { orderBy: { position: "asc" } },
      analysisJobs: {
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1,
        include: {
          queryDefinitions: {
            where: { validationStatus: "VALID" },
            include: {
              executions: {
                where: { status: "SUCCEEDED" },
                orderBy: { createdAt: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");
  const queries = new Map(
    (dashboard.analysisJobs[0]?.queryDefinitions ?? []).map((query) => [
      query.id,
      query,
    ]),
  );
  const widgets = dashboard.widgets.flatMap((widget) => {
    const config =
      widget.config &&
      typeof widget.config === "object" &&
      !Array.isArray(widget.config)
        ? widget.config
        : null;
    const parsed = dashboardWidgetDefinitionSchema.safeParse(
      config && "definition" in config ? config.definition : null,
    );
    return parsed.success ? [parsed.data] : [];
  });
  const queryResults = widgets.flatMap((widget) => {
    if (!widget.queryDefinitionId) return [];
    const query = queries.get(widget.queryDefinitionId);
    const preview = query?.executions[0]?.previewRows;
    const rows = Array.isArray(preview)
      ? preview.flatMap((row) =>
          row && typeof row === "object" && !Array.isArray(row)
            ? [row as Record<string, unknown>]
            : [],
        )
      : [];
    return [
      {
        widgetId: widget.id,
        queryId: widget.queryDefinitionId,
        purpose: query?.purpose,
        rows: applyFilters(rows, widget.filters, filters)
          .slice(0, configuration.QUERY_PREVIEW_ROWS)
          .map((row) =>
            sanitizeSampleRow(row, {
              maskSensitiveData: privacyPolicy.maskSensitiveData,
              maskingRules: privacyPolicy.maskingRules,
              maxLength: configuration.AI_MAX_SAMPLE_CELL_LENGTH,
            }),
          ),
      },
    ];
  });
  if (!queryResults.some((result) => result.rows.length)) {
    const generatedAt = new Date();
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DASHBOARD_FILTERED_INSIGHTS_GENERATED",
        entityType: "Dashboard",
        entityId: dashboard.id,
        entityName: dashboard.name,
        metadata: {
          filterKeys: Object.keys(filters),
          insights: [],
        } as Prisma.InputJsonValue,
      },
    });
    return success({
      insights: [] as DisplayInsight[],
      generatedAt: generatedAt.toISOString(),
    });
  }
  const response = await generateCachedStructuredOutput(context, {
    requestId: crypto.randomUUID(),
    schemaName: "filtered_dashboard_insights",
    outputSchema: generatedInsightsSchema(configuration.AI_MAX_INSIGHTS),
    systemPrompt: GROUNDING_SYSTEM_PROMPT,
    userPrompt: `Generate concise descriptive insights only from these filtered validated query previews. Do not infer causation or invent values. Use only supplied widgetId and queryId values as supporting identifiers. Active filters: ${JSON.stringify(filters)}\n\n${JSON.stringify(queryResults)}`,
    promptVersion: "filtered-dashboard-insights-v1",
  });
  if (!response.ok) return response;
  const grounded = validateInsightGrounding(
    response.data.data.insights,
    new Set(widgets.map((widget) => widget.id)),
    new Set(queries.keys()),
  );
  if (!grounded.ok) return grounded;
  const insights = grounded.data.map(
    ({ title, statement, confidence, caveats }) => ({
      title,
      statement,
      confidence,
      caveats,
    }),
  );
  const generatedAt = new Date();
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "DASHBOARD_FILTERED_INSIGHTS_GENERATED",
      entityType: "Dashboard",
      entityId: dashboard.id,
      entityName: dashboard.name,
      metadata: {
        filterKeys: Object.keys(filters),
        insights,
      } as Prisma.InputJsonValue,
    },
  });
  return success({ insights, generatedAt: generatedAt.toISOString() });
}

export async function acknowledgeDashboardInsight(
  context: AuthorizationContext,
  dashboardId: string,
  insight: DisplayInsight,
) {
  await requireDashboardAccess(context, dashboardId, "view");
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId: context.workspaceId },
    select: { id: true, name: true },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");
  const log = await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "DASHBOARD_INSIGHT_ACKNOWLEDGED",
      entityType: "Dashboard",
      entityId: dashboard.id,
      entityName: dashboard.name,
      metadata: { insight } as Prisma.InputJsonValue,
    },
  });
  return success({ acknowledgedAt: log.createdAt.toISOString() });
}
