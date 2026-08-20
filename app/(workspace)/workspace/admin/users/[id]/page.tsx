import { notFound } from "next/navigation";
import {
  EditUserForm,
  ResetUserPasswordForm,
} from "@/components/admin/edit-user-form";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  assignUserRoleAction,
  grantResourceAccessAction,
  updateUserStatusAction,
} from "@/features/admin/actions";
import { DeleteUserDialog } from "@/components/admin/user-table-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ensureOrganizationSystemRoles } from "@/server/services/system-role-service";

export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  await requirePermission(context, "user.update");
  await ensureOrganizationSystemRoles(context.organizationId);
  const [
    user,
    roles,
    sources,
    dashboards,
    activity,
    logins,
    canDelete,
    organizationUnits,
    projects,
  ] = await Promise.all([
    db.user.findFirst({
      where: {
        id,
        memberships: { some: { organizationId: context.organizationId } },
      },
      include: {
        userRoles: {
          where: { organizationId: context.organizationId },
          include: { role: true },
        },
        aiAccessPolicies: {
          where: { organizationId: context.organizationId },
        },
        dataSourceAccess: { include: { dataSource: true } },
        dashboardAccess: { include: { dashboard: true } },
        memberships: {
          where: { organizationId: context.organizationId },
          include: { projects: true },
        },
      },
    }),
    db.role.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
    }),
    db.dataSource.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, name: true },
    }),
    db.dashboard.findMany({
      where: { workspaceId: context.workspaceId },
      select: { id: true, name: true },
    }),
    db.auditLog.findMany({
      where: {
        organizationId: context.organizationId,
        OR: [{ actorId: id }, { entityType: "User", entityId: id }],
      },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    db.loginHistory.findMany({
      where: { organizationId: context.organizationId, userId: id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    hasPermission(context, "user.delete"),
    db.organizationUnit.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.organizationProject.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!user) notFound();
  return (
    <div className="space-y-6">
      <PageHeader
        title={user.name ?? user.email}
        description={`${user.email} · @${user.username ?? "unassigned"}`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          tone={
            user.status === "ACTIVE"
              ? "success"
              : user.status === "LOCKED"
                ? "warning"
                : "danger"
          }
        >
          {user.status.replaceAll("_", " ")}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Failed logins: {user.failedLoginCount} · Last login:{" "}
          {user.lastLoginAt?.toLocaleString() ?? "Never"}
        </span>
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Profile and AI access</h2>
        <EditUserForm
          user={{
            id: user.id,
            name: user.name,
            email: user.email,
            username: user.username,
            copilotEnabled: user.aiAccessPolicies[0]?.copilotEnabled ?? false,
            organizationUnitId: user.memberships[0]?.organizationUnitId ?? null,
            projectIds:
              user.memberships[0]?.projects.map(
                (project) => project.projectId,
              ) ?? [],
          }}
          organizationUnits={organizationUnits}
          projects={projects}
        />
      </section>
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Role and account state</h2>
          <form action={assignUserRoleAction} className="flex gap-2">
            <input type="hidden" name="userId" value={user.id} />
            <select
              name="roleId"
              defaultValue={user.userRoles[0]?.roleId}
              className="min-h-11 flex-1 rounded-lg border bg-white px-3"
            >
              {roles.map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
            </select>
            <button className="rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
              Assign
            </button>
          </form>
          <div className="mt-4 flex flex-wrap gap-2">
            {["ACTIVE", "LOCKED", "DISABLED"].map((status) => (
              <form key={status} action={updateUserStatusAction}>
                <input type="hidden" name="userId" value={user.id} />
                <input type="hidden" name="status" value={status} />
                <button className="min-h-10 rounded-lg border px-3 text-sm">
                  {status === "ACTIVE"
                    ? "Enable / unlock"
                    : status === "LOCKED"
                      ? "Lock"
                      : "Disable"}
                </button>
              </form>
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Administrator password reset</h2>
          <ResetUserPasswordForm userId={user.id} />
        </div>
      </section>
      <section className="grid gap-5 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Data source access</h2>
          <form action={grantResourceAccessAction} className="grid gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="resourceType" value="datasource" />
            <input type="hidden" name="canExport" value="false" />
            <select
              name="resourceId"
              className="min-h-11 rounded-lg border bg-white px-3"
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <select
              name="level"
              className="min-h-11 rounded-lg border bg-white px-3"
            >
              <option value="preview">Preview</option>
              <option value="build">Build dashboards</option>
              <option value="manage">Manage</option>
            </select>
            <button className="min-h-11 rounded-lg bg-slate-900 text-sm font-medium text-white">
              Grant access
            </button>
          </form>
          <ul className="mt-4 text-sm text-muted-foreground">
            {user.dataSourceAccess.map((access) => (
              <li key={access.id}>
                {access.dataSource.name} ·{" "}
                {access.canManage
                  ? "Manage"
                  : access.canBuild
                    ? "Build"
                    : "Preview"}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Dashboard access</h2>
          <form action={grantResourceAccessAction} className="grid gap-3">
            <input type="hidden" name="userId" value={user.id} />
            <input type="hidden" name="resourceType" value="dashboard" />
            <select
              name="resourceId"
              className="min-h-11 rounded-lg border bg-white px-3"
            >
              {dashboards.map((dashboard) => (
                <option key={dashboard.id} value={dashboard.id}>
                  {dashboard.name}
                </option>
              ))}
            </select>
            <select
              name="level"
              className="min-h-11 rounded-lg border bg-white px-3"
            >
              <option>VIEWER</option>
              <option>AI_ANALYST</option>
              <option>EDITOR</option>
              <option>OWNER</option>
            </select>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" name="canExport" /> Allow export
            </label>
            <button className="min-h-11 rounded-lg bg-slate-900 text-sm font-medium text-white">
              Grant access
            </button>
          </form>
          <ul className="mt-4 text-sm text-muted-foreground">
            {user.dashboardAccess.map((access) => (
              <li key={access.id}>
                {access.dashboard.name} · {access.level}
                {access.canExport ? " · Export" : ""}
              </li>
            ))}
          </ul>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Recent activity</h2>
        <div className="space-y-2">
          {activity.map((event) => (
            <div
              key={event.id}
              className="flex justify-between gap-4 border-b py-2 text-sm"
            >
              <span>
                {event.action} · {event.entityName ?? event.entityType}
              </span>
              <time className="text-muted-foreground">
                {event.createdAt.toLocaleString()}
              </time>
            </div>
          ))}
          {logins.map((event) => (
            <div
              key={event.id}
              className="flex justify-between gap-4 border-b py-2 text-sm"
            >
              <span>
                LOGIN {event.status} · {event.ipAddress ?? "unknown IP"}
              </span>
              <time className="text-muted-foreground">
                {event.createdAt.toLocaleString()}
              </time>
            </div>
          ))}
        </div>
      </section>
      {canDelete && user.id !== context.userId ? (
        <section className="rounded-xl border border-red-200 bg-red-50 p-5">
          <h2 className="font-semibold text-red-900">Delete user</h2>
          <p className="my-2 text-sm text-red-800">
            Soft-deletes the account and invalidates all active sessions.
          </p>
          <DeleteUserDialog
            user={{
              id: user.id,
              name: user.name,
              email: user.email,
              status: user.status,
            }}
          />
        </section>
      ) : null}
    </div>
  );
}
