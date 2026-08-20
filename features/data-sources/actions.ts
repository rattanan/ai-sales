"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  databaseConnectionSchema,
  databaseConnectionUpdateSchema,
  dashboardAppearanceSchema,
  dashboardObjectiveSchema,
  deleteDataSourceSchema,
} from "@/schemas/data-source";
import {
  databaseQuestionInputSchema,
  databaseQueryIdSchema,
  databaseScopeSchema,
} from "@/schemas/database-intelligence";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  hasPermission,
  requireDashboardAccess,
  requireDataSourceAccess,
  requirePermission,
} from "@/server/auth/permissions";
import {
  createDatabaseDataSource,
  deleteDataSource,
  updateDatabaseDataSource,
} from "@/server/services/data-source-service";
import { db } from "@/server/db";
import type { Prisma } from "@/generated/prisma/client";
import { logger } from "@/server/services/logger";
import { createAnalysisJob } from "@/server/services/analysis-job-service";
import { failure, success } from "@/types/result";
import type { AppResult } from "@/types/result";
import {
  enrichDatabaseMetadata,
  cancelDatabaseQuery,
  executeDatabaseQuery,
  proposeDatabaseQuery,
} from "@/server/services/database-intelligence-service";

export async function createDatabaseDataSourceAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.create");
  const parsed = databaseConnectionSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Please correct the connection details.",
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  return createDatabaseDataSource(context, parsed.data);
}

export async function updateDatabaseDataSourceAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.update");
  const parsed = databaseConnectionUpdateSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Please correct the connection details.",
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  await requireDataSourceAccess(context, parsed.data.dataSourceId, "manage");
  const result = await updateDatabaseDataSource(context, parsed.data);
  if (result.ok)
    revalidatePath(`/workspace/data-sources/${parsed.data.dataSourceId}`);
  return result;
}

export async function deleteDataSourceAction(
  _previous: AppResult<{ deleted: true; id: string }> | null,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.delete");
  const parsed = deleteDataSourceSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return failure(
      "VALIDATION_ERROR",
      "Confirm the data source name to delete it.",
      {
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    );
  }
  await requireDataSourceAccess(context, parsed.data.dataSourceId, "manage");
  return deleteDataSource(
    context,
    parsed.data.dataSourceId,
    parsed.data.confirmationName,
  );
}

export async function saveDataScopeAction(
  dataSourceId: string,
  tableIds: string[],
  autoPrioritizeTables = false,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.update");
  await requireDataSourceAccess(context, dataSourceId, "manage");
  const source = await db.dataSource.findFirst({
    where: { id: dataSourceId, workspaceId: context.workspaceId },
  });
  if (!source) return failure("NOT_FOUND", "Data source not found.");
  const connectionOptions =
    source.connectionOptions &&
    typeof source.connectionOptions === "object" &&
    !Array.isArray(source.connectionOptions)
      ? source.connectionOptions
      : {};
  await db.$transaction(async (tx) => {
    await tx.dataSourceTable.updateMany({
      where: { schema: { dataSourceId } },
      data: { selected: false, sampleDataEnabled: false },
    });
    await tx.dataSourceTable.updateMany({
      where: { id: { in: tableIds }, schema: { dataSourceId } },
      data: { selected: true },
    });
    await tx.dataSourceSchema.updateMany({
      where: { dataSourceId },
      data: { selected: false },
    });
    await tx.dataSourceSchema.updateMany({
      where: { dataSourceId, tables: { some: { id: { in: tableIds } } } },
      data: { selected: true },
    });
    await tx.dataSource.update({
      where: { id: source.id },
      data: {
        sourceStatus: tableIds.length ? "READY" : "DRAFT",
        ...(source.type === "ORACLE"
          ? {
              connectionOptions: {
                ...connectionOptions,
                autoPrioritizeTables,
              } as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  });
  return success({ selected: tableIds.length });
}

export async function saveDatabaseScopeAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.update");
  const parsed = databaseScopeSchema.safeParse({
    dataSourceId: formData.get("dataSourceId"),
    sampleDataEnabled: formData.get("sampleDataEnabled"),
    selectedTableIds: formData.getAll("selectedTableIds"),
    sampleTableIds: formData.getAll("sampleTableIds"),
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the database scope settings.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  await requireDataSourceAccess(context, parsed.data.dataSourceId, "manage");
  const selectedIds = [...new Set(parsed.data.selectedTableIds)];
  const sampleIds = [...new Set(parsed.data.sampleTableIds)];
  if (sampleIds.some((id) => !selectedIds.includes(id)))
    return failure(
      "VALIDATION_ERROR",
      "Sample access can only be enabled for selected tables.",
    );
  const source = await db.dataSource.findFirst({
    where: {
      id: parsed.data.dataSourceId,
      workspaceId: context.workspaceId,
      type: { in: ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] },
    },
    select: { id: true },
  });
  if (!source) return failure("NOT_FOUND", "Database source not found.");
  const validCount = await db.dataSourceTable.count({
    where: { id: { in: selectedIds }, schema: { dataSourceId: source.id } },
  });
  if (validCount !== selectedIds.length)
    return failure(
      "VALIDATION_ERROR",
      "Database scope contains an invalid table.",
    );
  await db.$transaction(async (tx) => {
    await tx.dataSourceTable.updateMany({
      where: { schema: { dataSourceId: source.id } },
      data: { selected: false, sampleDataEnabled: false },
    });
    await tx.dataSourceTable.updateMany({
      where: { id: { in: selectedIds }, schema: { dataSourceId: source.id } },
      data: { selected: true },
    });
    if (parsed.data.sampleDataEnabled && sampleIds.length)
      await tx.dataSourceTable.updateMany({
        where: { id: { in: sampleIds }, schema: { dataSourceId: source.id } },
        data: { sampleDataEnabled: true },
      });
    await tx.dataSourceSchema.updateMany({
      where: { dataSourceId: source.id },
      data: { selected: false },
    });
    await tx.dataSourceSchema.updateMany({
      where: {
        dataSourceId: source.id,
        tables: { some: { id: { in: selectedIds } } },
      },
      data: { selected: true },
    });
    await tx.dataSource.update({
      where: { id: source.id },
      data: {
        sampleDataEnabled: parsed.data.sampleDataEnabled,
        sourceStatus: selectedIds.length ? "READY" : "DRAFT",
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "DATABASE_SCOPE_UPDATED",
        entityType: "DataSource",
        entityId: source.id,
        outcome: "SUCCESS",
        metadata: {
          selectedTableCount: selectedIds.length,
          sampleTableCount: parsed.data.sampleDataEnabled
            ? sampleIds.length
            : 0,
        },
      },
    });
  });
  revalidatePath(`/workspace/data-sources/${source.id}`);
  return success({
    selected: selectedIds.length,
    samples: parsed.data.sampleDataEnabled ? sampleIds.length : 0,
  });
}

export async function enrichDatabaseMetadataAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "datasource.update");
  const dataSourceId = String(formData.get("dataSourceId") ?? "");
  if (!dataSourceId)
    return failure("VALIDATION_ERROR", "Data source is required.");
  const result = await enrichDatabaseMetadata(context, dataSourceId);
  if (result.ok) revalidatePath(`/workspace/data-sources/${dataSourceId}`);
  return result;
}

export async function proposeDatabaseQueryAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = databaseQuestionInputSchema.safeParse({
    dataSourceId: formData.get("dataSourceId"),
    question: formData.get("question"),
    botId: formData.get("botId") || undefined,
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Enter a database question.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  return proposeDatabaseQuery(context, parsed.data);
}

export async function executeDatabaseQueryAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = databaseQueryIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Validated query is required.");
  return executeDatabaseQuery(context, parsed.data.id);
}

export async function cancelDatabaseQueryAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = databaseQueryIdSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Running query is required.");
  return cancelDatabaseQuery(context, parsed.data.id);
}

export async function saveObjectiveAction(input: unknown) {
  const context = await requireAuthorization();
  const parsed = dashboardObjectiveSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Please complete the dashboard objective.",
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  const source = await db.dataSource.findFirst({
    where: { id: parsed.data.dataSourceId, workspaceId: context.workspaceId },
  });
  if (!source) return failure("NOT_FOUND", "Data source not found.");
  if (!(await hasPermission(context, "role.manage"))) {
    await requireDataSourceAccess(context, source.id, "build");
  }
  const values = {
    name: parsed.data.name,
    businessArea: parsed.data.businessArea,
    businessObjective: parsed.data.businessObjective,
    businessQuestions: parsed.data.businessQuestions,
    desiredKpis: parsed.data.desiredKpis,
    targetUsers: parsed.data.targetUsers,
    reportingPeriod: parsed.data.reportingPeriod,
    importantFilters: parsed.data.importantFilters,
  };
  let dashboard;
  if (parsed.data.dashboardId) {
    await requirePermission(context, "dashboard.update");
    await requireDashboardAccess(context, parsed.data.dashboardId, "edit");
    const existing = await db.dashboard.findFirst({
      where: {
        id: parsed.data.dashboardId,
        workspaceId: context.workspaceId,
        dataSources: { some: { dataSourceId: source.id } },
      },
      select: { id: true },
    });
    if (!existing) return failure("NOT_FOUND", "Dashboard draft not found.");
    dashboard = await db.dashboard.update({
      where: {
        id: existing.id,
      },
      data: values,
    });
    revalidatePath(`/workspace/dashboards/${dashboard.id}`);
    revalidatePath("/workspace/dashboards");
  } else {
    await requirePermission(context, "dashboard.create");
    dashboard = await db.dashboard.create({
      data: {
        ...values,
        workspaceId: context.workspaceId,
        createdById: context.userId,
        dataSources: { create: { dataSourceId: source.id } },
        access: {
          create: {
            organizationId: context.organizationId,
            userId: context.userId,
            level: "OWNER",
            canExport: true,
            grantedById: context.userId,
          },
        },
      },
    });
  }
  return success({ dashboardId: dashboard.id });
}

export async function saveAppearanceAction(input: unknown) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  const parsed = dashboardAppearanceSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Choose a layout, style, and theme.");
  const { dashboardId, ...appearance } = parsed.data;
  const requestId = crypto.randomUUID();
  try {
    const dashboard = await db.dashboard.findFirst({
      where: { id: dashboardId, workspaceId: context.workspaceId },
      select: { id: true },
    });
    if (!dashboard) return failure("NOT_FOUND", "Dashboard draft not found.");
    await requireDashboardAccess(context, dashboard.id, "edit");

    await db.dashboard.update({
      where: { id: dashboard.id },
      data: appearance,
    });
    return success({ dashboardId: dashboard.id });
  } catch (error) {
    logger.error("Dashboard appearance update failed", {
      requestId,
      dashboardId,
      workspaceId: context.workspaceId,
      error,
    });
    return failure(
      "INTERNAL_ERROR",
      "The dashboard appearance could not be saved. Try again.",
      {
        requestId,
        diagnostics: { operation: "saveDashboardAppearance" },
      },
    );
  }
}

export async function startAnalysisAction(dashboardId: string) {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  await requireDashboardAccess(context, dashboardId, "edit");
  const result = await createAnalysisJob(context, dashboardId);
  if (!result.ok) return result;
  redirect(`/workspace/dashboards/${dashboardId}/analysis`);
}
