"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import {
  approveAnalysisRecommendations,
  finalizeAnalysisDashboard,
  regenerateAnalysisRecommendation,
  updateRecommendationDecision,
} from "@/server/services/analysis-review-service";
import { db } from "@/server/db";
import {
  bulkRecommendationApprovalSchema,
  dashboardWidgetDefinitionSchema,
  dashboardWidgetDeleteSchema,
  dashboardWidgetEditSchema,
} from "@/schemas/analysis";
import { failure, success } from "@/types/result";
import type { Prisma } from "@/generated/prisma/client";

export async function updateRecommendationDecisionAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const recommendationId =
    typeof input === "object" && input && "recommendationId" in input
      ? String(input.recommendationId)
      : "";
  const recommendation = await db.analysisRecommendation.findFirst({
    where: {
      id: recommendationId,
      analysisJob: { workspaceId: context.workspaceId },
    },
    select: { analysisJob: { select: { dashboardId: true } } },
  });
  if (!recommendation) throw new Error("NOT_FOUND");
  await requireDashboardAccess(
    context,
    recommendation.analysisJob.dashboardId,
    "edit",
  );
  const result = await updateRecommendationDecision(context, input);
  if (result.ok) revalidatePath("/workspace/dashboards");
  return result;
}

export async function approveRecommendationsAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const parsed = bulkRecommendationApprovalSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Review the selected items and try again.",
      {
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    );
  const job = await db.analysisJob.findFirst({
    where: {
      id: parsed.data.analysisJobId,
      workspaceId: context.workspaceId,
    },
    select: { dashboardId: true },
  });
  if (!job) throw new Error("NOT_FOUND");
  await requireDashboardAccess(context, job.dashboardId, "edit");
  const result = await approveAnalysisRecommendations(context, parsed.data);
  if (result.ok) {
    revalidatePath(`/workspace/dashboards/${job.dashboardId}/analysis`);
    revalidatePath(`/workspace/dashboards/${job.dashboardId}`);
  }
  return result;
}

export async function finalizeDashboardAction(analysisJobId: string) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const job = await db.analysisJob.findFirst({
    where: { id: analysisJobId, workspaceId: context.workspaceId },
    select: { dashboardId: true },
  });
  if (!job) throw new Error("NOT_FOUND");
  await requireDashboardAccess(context, job.dashboardId, "edit");
  const result = await finalizeAnalysisDashboard(context, analysisJobId);
  if (!result.ok) return result;
  redirect(`/workspace/dashboards/${result.data.dashboardId}`);
}

export async function reorderDashboardWidgetAction(
  widgetId: string,
  direction: "UP" | "DOWN",
) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const widget = await db.dashboardWidget.findFirst({
    where: { id: widgetId, dashboard: { workspaceId: context.workspaceId } },
  });
  if (!widget) return { ok: false as const, message: "Widget not found." };
  await requireDashboardAccess(context, widget.dashboardId, "edit");
  const target = await db.dashboardWidget.findFirst({
    where: {
      dashboardId: widget.dashboardId,
      position:
        direction === "UP" ? { lt: widget.position } : { gt: widget.position },
    },
    orderBy: { position: direction === "UP" ? "desc" : "asc" },
  });
  if (!target) return { ok: true as const };
  await db.$transaction([
    db.dashboardWidget.update({
      where: { id: widget.id },
      data: { position: target.position },
    }),
    db.dashboardWidget.update({
      where: { id: target.id },
      data: { position: widget.position },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DASHBOARD_WIDGET_REORDERED",
        entityType: "DashboardWidget",
        entityId: widget.id,
        metadata: { direction },
      },
    }),
  ]);
  revalidatePath(`/workspace/dashboards/${widget.dashboardId}`);
  return { ok: true as const };
}

export async function updateDashboardWidgetAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const parsed = dashboardWidgetEditSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the widget settings.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const widget = await db.dashboardWidget.findFirst({
    where: {
      id: parsed.data.widgetId,
      dashboard: { workspaceId: context.workspaceId },
    },
  });
  if (!widget) return failure("NOT_FOUND", "Widget not found.");
  await requireDashboardAccess(context, widget.dashboardId, "edit");
  const config =
    widget.config &&
    typeof widget.config === "object" &&
    !Array.isArray(widget.config)
      ? widget.config
      : null;
  const definition = dashboardWidgetDefinitionSchema.safeParse(
    config && "definition" in config ? config.definition : null,
  );
  if (!definition.success)
    return failure("AI_INVALID_RESPONSE", "The saved widget is invalid.");
  const updatedDefinition = dashboardWidgetDefinitionSchema.safeParse({
    ...definition.data,
    type: parsed.data.widgetType,
    title: parsed.data.title,
    description: parsed.data.description,
    thresholds: parsed.data.gaugeTarget
      ? [
          {
            value: parsed.data.gaugeTarget,
            operator: "GTE",
            tone: "POSITIVE",
            label: "Target",
          },
        ]
      : definition.data.thresholds,
  });
  if (!updatedDefinition.success)
    return failure(
      "VALIDATION_ERROR",
      "The selected chart type is incompatible with this widget's validated data mapping.",
      { fieldErrors: updatedDefinition.error.flatten().fieldErrors },
    );
  await db.$transaction([
    db.dashboardWidget.update({
      where: { id: widget.id },
      data: {
        title: updatedDefinition.data.title,
        type: updatedDefinition.data.type,
        config: {
          ...config,
          definition: updatedDefinition.data,
        } as Prisma.InputJsonValue,
      },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DASHBOARD_WIDGET_UPDATED",
        entityType: "DashboardWidget",
        entityId: widget.id,
        beforeValue: { title: widget.title, type: widget.type },
        afterValue: {
          title: updatedDefinition.data.title,
          type: updatedDefinition.data.type,
        },
      },
    }),
  ]);
  revalidatePath(`/workspace/dashboards/${widget.dashboardId}`);
  revalidatePath(`/workspace/dashboards/${widget.dashboardId}/edit`);
  return success({ updated: true as const });
}

export async function deleteDashboardWidgetAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const parsed = dashboardWidgetDeleteSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Widget selection is invalid.");
  const widget = await db.dashboardWidget.findFirst({
    where: {
      id: parsed.data.widgetId,
      dashboard: { workspaceId: context.workspaceId },
    },
  });
  if (!widget) return failure("NOT_FOUND", "Widget not found.");
  await requireDashboardAccess(context, widget.dashboardId, "edit");
  await db.$transaction([
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DASHBOARD_WIDGET_DELETED",
        entityType: "DashboardWidget",
        entityId: widget.id,
        entityName: widget.title,
        beforeValue: { title: widget.title, type: widget.type },
      },
    }),
    db.dashboardWidget.delete({ where: { id: widget.id } }),
  ]);
  revalidatePath(`/workspace/dashboards/${widget.dashboardId}`);
  revalidatePath(`/workspace/dashboards/${widget.dashboardId}/edit`);
  return success({ deleted: true as const });
}

export async function regenerateRecommendationAction(recommendationId: string) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const recommendation = await db.analysisRecommendation.findFirst({
    where: {
      id: recommendationId,
      analysisJob: { workspaceId: context.workspaceId },
    },
    select: { analysisJob: { select: { dashboardId: true } } },
  });
  if (!recommendation) throw new Error("NOT_FOUND");
  await requireDashboardAccess(
    context,
    recommendation.analysisJob.dashboardId,
    "edit",
  );
  const result = await regenerateAnalysisRecommendation(
    context,
    recommendationId,
  );
  if (result.ok) revalidatePath("/workspace/dashboards");
  return result;
}
