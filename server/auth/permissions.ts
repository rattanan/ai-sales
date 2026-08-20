import { db } from "@/server/db";
import type { AuthorizationContext } from "./authorization";
import {
  LEGACY_ROLE_PERMISSIONS,
  type PermissionKey,
} from "./permission-catalog";

export async function getPermissionKeys(context: AuthorizationContext) {
  const rows = await db.rolePermission.findMany({
    where: {
      role: {
        organizationId: context.organizationId,
        users: { some: { userId: context.userId } },
      },
    },
    select: { permission: { select: { key: true } } },
  });
  return new Set([
    ...(LEGACY_ROLE_PERMISSIONS[context.role] ?? []),
    ...rows.map((row) => row.permission.key),
  ]);
}

export async function hasPermission(
  context: AuthorizationContext,
  permission: PermissionKey,
) {
  return (
    (LEGACY_ROLE_PERMISSIONS[context.role] ?? []).includes(permission) ||
    (await db.rolePermission.count({
      where: {
        permission: { key: permission },
        role: {
          organizationId: context.organizationId,
          users: { some: { userId: context.userId } },
        },
      },
    })) > 0
  );
}

export async function requirePermission(
  context: AuthorizationContext,
  permission: PermissionKey,
) {
  if (!(await hasPermission(context, permission))) {
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "PERMISSION_DENIED",
        entityType: "Permission",
        entityName: permission,
        outcome: "DENIED",
        metadata: { permission },
      },
    });
    throw new Error("FORBIDDEN");
  }
  return context;
}

export async function requireDataSourceAccess(
  context: AuthorizationContext,
  dataSourceId: string,
  action: "preview" | "build" | "manage" = "preview",
) {
  const managementPermission = action === "manage" ? "datasource.update" : null;
  if (
    (managementPermission &&
      (await hasPermission(context, managementPermission))) ||
    (await db.dataSourceAccess.count({
      where: {
        dataSourceId,
        userId: context.userId,
        organizationId: context.organizationId,
        ...(action === "preview" ? { canPreview: true } : {}),
        ...(action === "build"
          ? { OR: [{ canBuild: true }, { canManage: true }] }
          : {}),
        ...(action === "manage" ? { canManage: true } : {}),
        dataSource: { workspaceId: context.workspaceId },
      },
    })) > 0
  )
    return context;
  throw new Error("NOT_FOUND");
}

export async function requireDashboardAccess(
  context: AuthorizationContext,
  dashboardId: string,
  action: "view" | "edit" | "publish" | "export" | "copilot" = "view",
) {
  const dashboard = await db.dashboard.findFirst({
    where: { id: dashboardId, workspaceId: context.workspaceId },
    select: { createdById: true, status: true },
  });
  if (!dashboard) throw new Error("NOT_FOUND");
  if (await hasPermission(context, "role.manage")) return context;
  if (dashboard.createdById === context.userId) return context;

  const access = await db.dashboardAccess.findUnique({
    where: { dashboardId_userId: { dashboardId, userId: context.userId } },
  });
  const allowed =
    access &&
    (action === "view"
      ? dashboard.status === "PUBLISHED" ||
        ["OWNER", "EDITOR"].includes(access.level)
      : action === "edit"
        ? ["OWNER", "EDITOR"].includes(access.level)
        : action === "publish"
          ? access.level === "OWNER" &&
            (await hasPermission(context, "dashboard.publish"))
          : action === "export"
            ? access.canExport
            : access.level === "AI_ANALYST" ||
              ["OWNER", "EDITOR"].includes(access.level));
  if (!allowed) throw new Error("NOT_FOUND");
  if (action === "copilot") {
    const policy = await db.aIAccessPolicy.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
    });
    if (
      !policy?.copilotEnabled ||
      !(await hasPermission(context, "copilot.use"))
    )
      throw new Error("FORBIDDEN");
  }
  return context;
}
