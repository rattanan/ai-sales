import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import {
  hasPermission,
  requireDashboardAccess,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { type CopilotChartType, type CopilotPrompt } from "@/schemas/copilot";
import { dashboardWidgetDefinitionSchema } from "@/schemas/analysis";
import { failure, success, type AppResult } from "@/types/result";

export type CopilotFilterSuggestion = {
  value: string;
  datePreset?:
    | "TODAY"
    | "YESTERDAY"
    | "THIS_WEEK"
    | "LAST_WEEK"
    | "THIS_MONTH"
    | "LAST_MONTH"
    | "THIS_YEAR"
    | "LAST_YEAR";
};

export type CopilotReply = {
  id: string;
  answer: string;
  intent: "QUESTION" | "FILTER" | "EDIT_WIDGET" | "EXPLAIN";
  generatedSql?: string;
  selectedWidgetId?: string;
  filters?: CopilotFilterSuggestion[];
  action?: {
    type: "CHART_CHANGED";
    widgetId: string;
    chartType: CopilotChartType;
  };
  suggestions: string[];
  createdAt: string;
};

function chartTypeFromPrompt(prompt: string): CopilotChartType | null {
  const normalized = prompt.toLowerCase();
  if (/horizontal\s+bar/.test(normalized)) return "HORIZONTAL_BAR_CHART";
  if (/stacked\s+bar/.test(normalized)) return "STACKED_BAR_CHART";
  if (/\bbar\b/.test(normalized)) return "BAR_CHART";
  if (/\bline\b/.test(normalized)) return "LINE_CHART";
  if (/\barea\b/.test(normalized)) return "AREA_CHART";
  if (/\bpie\b/.test(normalized)) return "PIE_CHART";
  if (/\bdonut\b/.test(normalized)) return "DONUT_CHART";
  if (/\bgauge\b/.test(normalized)) return "GAUGE";
  if (/\btable\b/.test(normalized)) return "TABLE";
  return null;
}

function datePresetFromPrompt(
  prompt: string,
): CopilotFilterSuggestion["datePreset"] {
  const normalized = prompt.toLowerCase();
  if (/\btoday\b/.test(normalized)) return "TODAY";
  if (/\byesterday\b/.test(normalized)) return "YESTERDAY";
  if (/\bthis week\b/.test(normalized)) return "THIS_WEEK";
  if (/\blast week\b/.test(normalized)) return "LAST_WEEK";
  if (/\bthis month\b/.test(normalized)) return "THIS_MONTH";
  if (/\blast month\b/.test(normalized)) return "LAST_MONTH";
  if (/\bthis year\b/.test(normalized)) return "THIS_YEAR";
  if (/\blast year\b|\bprevious year\b/.test(normalized)) return "LAST_YEAR";
  return undefined;
}

function filterValueFromPrompt(prompt: string) {
  const match = prompt.match(
    /(?:only\s+(?:show|for)|show\s+only|filter(?:\s+only)?\s+(?:for|to)?|hide)\s+(.+)/i,
  );
  return match?.[1]?.replace(/[.?!]+$/, "").trim() || null;
}

function topLimitFromPrompt(prompt: string) {
  const match = prompt.match(/\btop\s+(\d{1,3})\b/i);
  return match ? Math.min(Math.max(Number(match[1]), 1), 100) : null;
}

function numericValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function logCopilot(
  context: AuthorizationContext,
  input: {
    dashboardId: string;
    dataSourceId?: string;
    question: string;
    generatedSql?: string;
    executionStatus: string;
    finalAnswer: string;
    responseTimeMs: number;
  },
) {
  return db.aiCopilotLog.create({
    data: {
      organizationId: context.organizationId,
      userId: context.userId,
      dashboardId: input.dashboardId,
      dataSourceId: input.dataSourceId,
      question: input.question,
      generatedSql: input.generatedSql,
      executionStatus: input.executionStatus,
      finalAnswer: input.finalAnswer,
      responseTimeMs: input.responseTimeMs,
    },
  });
}

export async function copilotHistory(
  context: AuthorizationContext,
  dashboardId: string,
) {
  await requireDashboardAccess(context, dashboardId, "copilot");
  const history = await db.aiCopilotLog.findMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      dashboardId,
    },
    orderBy: { createdAt: "desc" },
    take: 40,
    select: {
      id: true,
      question: true,
      finalAnswer: true,
      generatedSql: true,
      createdAt: true,
    },
  });
  return success(
    history.reverse().map((entry) => ({
      id: entry.id,
      question: entry.question,
      answer: entry.finalAnswer ?? "No response was saved.",
      generatedSql: entry.generatedSql ?? undefined,
      createdAt: entry.createdAt.toISOString(),
    })),
  );
}

export async function askCopilot(
  context: AuthorizationContext,
  input: CopilotPrompt,
): Promise<AppResult<CopilotReply>> {
  const startedAt = performance.now();
  await requireDashboardAccess(context, input.dashboardId, "copilot");
  const dashboard = await db.dashboard.findFirst({
    where: { id: input.dashboardId, workspaceId: context.workspaceId },
    include: {
      dataSources: {
        include: { dataSource: { select: { id: true, name: true } } },
      },
      widgets: { orderBy: { position: "asc" } },
      analysisJobs: {
        where: { status: "COMPLETED" },
        orderBy: { completedAt: "desc" },
        take: 1,
        include: {
          queryDefinitions: {
            where: { validationStatus: "VALID" },
            select: {
              id: true,
              sql: true,
              purpose: true,
              executions: {
                where: { status: "SUCCEEDED" },
                orderBy: { completedAt: "desc" },
                take: 1,
                select: { previewRows: true },
              },
            },
          },
        },
      },
    },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");

  const selectedWidget = input.selectedWidgetId
    ? dashboard.widgets.find((widget) => widget.id === input.selectedWidgetId)
    : undefined;
  const prompt = input.prompt.trim();
  const chartType = chartTypeFromPrompt(prompt);
  const topLimit = topLimitFromPrompt(prompt);
  const latestQueries = dashboard.analysisJobs[0]?.queryDefinitions ?? [];
  const selectedDefinition = dashboardWidgetDefinitionSchema.safeParse(
    selectedWidget &&
      selectedWidget.config &&
      typeof selectedWidget.config === "object" &&
      "definition" in selectedWidget.config
      ? selectedWidget.config.definition
      : null,
  );
  const selectedSql = selectedDefinition.success
    ? latestQueries.find(
        (query) => query.id === selectedDefinition.data.queryDefinitionId,
      )?.sql
    : undefined;

  let reply: Omit<CopilotReply, "id" | "createdAt">;
  let status = "ANSWERED";
  if (chartType) {
    if (!selectedWidget || !selectedDefinition.success) {
      reply = {
        intent: "EDIT_WIDGET",
        answer:
          "Select a chart first, then ask me to change its visualization. I will keep its validated data mapping unchanged.",
        suggestions: [
          "Select a widget, then say “change this to a bar chart”.",
        ],
      };
      status = "NEEDS_SELECTION";
    } else if (!(await hasPermission(context, "dashboard.update"))) {
      reply = {
        intent: "EDIT_WIDGET",
        answer: "Your role can ask questions but cannot modify this dashboard.",
        selectedWidgetId: selectedWidget.id,
        generatedSql: selectedSql,
        suggestions: ["Ask me to explain this KPI or show the validated SQL."],
      };
      status = "DENIED";
    } else {
      await requireDashboardAccess(context, dashboard.id, "edit");
      const nextDefinition = dashboardWidgetDefinitionSchema.safeParse({
        ...selectedDefinition.data,
        type: chartType,
      });
      if (!nextDefinition.success)
        return failure(
          "VALIDATION_ERROR",
          "That chart type is incompatible with the selected widget.",
        );
      await db.$transaction([
        db.dashboardWidget.update({
          where: { id: selectedWidget.id },
          data: {
            type: chartType,
            config: {
              ...(selectedWidget.config as Record<string, unknown>),
              definition: nextDefinition.data,
            } as Prisma.InputJsonValue,
          },
        }),
        db.auditLog.create({
          data: {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            actorId: context.userId,
            action: "COPILOT_WIDGET_CHART_CHANGED",
            entityType: "DashboardWidget",
            entityId: selectedWidget.id,
            entityName: selectedWidget.title,
            metadata: { chartType, dashboardId: dashboard.id },
          },
        }),
      ]);
      revalidatePath(`/workspace/dashboards/${dashboard.id}`);
      revalidatePath(`/workspace/dashboards/${dashboard.id}/edit`);
      reply = {
        intent: "EDIT_WIDGET",
        answer: `Changed “${selectedWidget.title}” to ${chartType.replaceAll("_", " ").toLowerCase()}. The underlying validated query was not changed.`,
        selectedWidgetId: selectedWidget.id,
        generatedSql: selectedSql,
        action: {
          type: "CHART_CHANGED",
          widgetId: selectedWidget.id,
          chartType,
        },
        suggestions: [
          "Explain this KPI",
          "Show the SQL",
          "Change this to a table",
        ],
      };
      status = "APPLIED";
    }
  } else {
    const datePreset = datePresetFromPrompt(prompt);
    const filterValue = filterValueFromPrompt(prompt);
    if (topLimit) {
      const widget = selectedWidget ?? dashboard.widgets[0];
      const definition = dashboardWidgetDefinitionSchema.safeParse(
        widget &&
          widget.config &&
          typeof widget.config === "object" &&
          "definition" in widget.config
          ? widget.config.definition
          : null,
      );
      const query = definition.success
        ? latestQueries.find(
            (item) => item.id === definition.data.queryDefinitionId,
          )
        : undefined;
      const category = definition.data?.dataMapping.dimensions[0];
      const measure = definition.data?.dataMapping.measures[0];
      const rows = Array.isArray(query?.executions[0]?.previewRows)
        ? (query.executions[0]?.previewRows as Record<string, unknown>[])
        : [];
      if (!widget || !definition.success || !query || !category || !measure) {
        reply = {
          intent: "QUESTION",
          answer:
            "Select a chart with a category and measure first, then ask for its top values.",
          suggestions: ["Select a widget, then say “Show top 10”"],
        };
        status = "NEEDS_SELECTION";
      } else {
        const topRows = rows
          .map((row) => ({
            label: String(row[category] ?? "Unknown"),
            value: numericValue(row[measure]),
          }))
          .filter(
            (row): row is { label: string; value: number } => row.value != null,
          )
          .sort((left, right) => right.value - left.value)
          .slice(0, topLimit);
        reply = {
          intent: "QUESTION",
          answer: topRows.length
            ? `Top ${topRows.length} for “${widget.title}” by ${measure}:\n${topRows.map((row, index) => `${index + 1}. ${row.label}: ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(row.value)}`).join("\n")}`
            : `The latest validated result for “${widget.title}” has no numeric values for ${measure}.`,
          selectedWidgetId: widget.id,
          generatedSql: query.sql,
          suggestions: ["Show the SQL", "Explain this KPI", "Show top 10"],
        };
        status = "TOP_VALUES";
      }
    } else if (datePreset || filterValue) {
      reply = {
        intent: "FILTER",
        answer: datePreset
          ? `I applied the ${datePreset.replaceAll("_", " ").toLowerCase()} date range to the dashboard filters.`
          : `I applied “${filterValue}” to the closest matching dashboard filter.`,
        filters: [
          ...(datePreset ? [{ value: "", datePreset }] : []),
          ...(filterValue ? [{ value: filterValue }] : []),
        ],
        selectedWidgetId: selectedWidget?.id,
        generatedSql: selectedSql,
        suggestions: [
          "Show top 10",
          "Compare this month with last month",
          "Reset filters",
        ],
      };
      status = "FILTER_APPLIED";
    } else if (/\b(why|explain|what is|how is)\b/i.test(prompt)) {
      const widgetName = selectedWidget?.title ?? "this dashboard";
      reply = {
        intent: "EXPLAIN",
        answer: selectedDefinition.success
          ? `“${widgetName}” answers: ${selectedDefinition.data.businessQuestion} It is based on the dashboard’s validated query and updates only from the approved data source.`
          : `This dashboard is organized around ${dashboard.businessObjective ?? "its configured business objective"}. Select a widget for a calculation-level explanation.`,
        selectedWidgetId: selectedWidget?.id,
        generatedSql: selectedSql,
        suggestions: ["Show the SQL", "Explain this KPI", "Show top 10"],
      };
    } else {
      reply = {
        intent: "QUESTION",
        answer: `I can help analyze “${dashboard.name}”. Select a widget for a grounded answer, ask for a date or category filter, or ask to change a selected chart. I only use validated dashboard queries.`,
        selectedWidgetId: selectedWidget?.id,
        generatedSql: selectedSql,
        suggestions: [
          "Explain this KPI",
          "Show top 10",
          "Compare this month with last month",
        ],
      };
    }
  }
  const elapsed = Math.round(performance.now() - startedAt);
  const log = await logCopilot(context, {
    dashboardId: dashboard.id,
    dataSourceId: dashboard.dataSources[0]?.dataSource.id,
    question: prompt,
    generatedSql: reply.generatedSql,
    executionStatus: status,
    finalAnswer: reply.answer,
    responseTimeMs: elapsed,
  });
  return success({
    ...reply,
    id: log.id,
    createdAt: log.createdAt.toISOString(),
  });
}
