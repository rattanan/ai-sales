"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  dashboardMutationSchema,
  deleteDashboardSchema,
} from "@/schemas/data-source";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { createAnalysisJob } from "@/server/services/analysis-job-service";
import type { AppResult } from "@/types/result";
import { failure, success } from "@/types/result";

export async function analyzeDashboardAction(
  _previous: AppResult<{ started: true }> | null,
  formData: FormData,
) {
  const parsed = dashboardMutationSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Dashboard selection is invalid.");
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  await requireDashboardAccess(context, parsed.data.dashboardId, "edit");
  const result = await createAnalysisJob(context, parsed.data.dashboardId);
  if (!result.ok) return result;
  redirect(`/workspace/dashboards/${parsed.data.dashboardId}/analysis`);
}

export async function deleteDashboardAction(
  _previous: AppResult<{ deleted: true }> | null,
  formData: FormData,
) {
  const parsed = deleteDashboardSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Enter the dashboard name to confirm.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.delete");
  await requireDashboardAccess(context, parsed.data.dashboardId, "edit");
  const dashboard = await db.dashboard.findFirst({
    where: {
      id: parsed.data.dashboardId,
      workspaceId: context.workspaceId,
    },
    include: {
      _count: {
        select: { widgets: true, versions: true, analysisJobs: true },
      },
      analysisJobs: {
        where: { status: { in: ["QUEUED", "RUNNING"] } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!dashboard) return failure("NOT_FOUND", "Dashboard not found.");
  if (parsed.data.confirmationName !== dashboard.name)
    return failure(
      "VALIDATION_ERROR",
      "The confirmation name does not match the dashboard name.",
      {
        fieldErrors: {
          confirmationName: ["Enter the exact dashboard name."],
        },
      },
    );
  if (dashboard.analysisJobs.length)
    return failure(
      "CONFLICT",
      "Cancel or wait for the active analysis before deleting this dashboard.",
    );
  await db.$transaction([
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DASHBOARD_DELETED",
        entityType: "Dashboard",
        entityId: dashboard.id,
        entityName: dashboard.name,
        beforeValue: {
          status: dashboard.status,
          widgets: dashboard._count.widgets,
          versions: dashboard._count.versions,
          analysisJobs: dashboard._count.analysisJobs,
        },
      },
    }),
    db.dashboard.delete({ where: { id: dashboard.id } }),
  ]);
  revalidatePath("/workspace/dashboards");
  revalidatePath("/workspace");
  return success({ deleted: true as const });
}
