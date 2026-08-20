import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function AdminDashboardPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "user.update");
  const [users, roles, providers, units, projects, recentEvents] =
    await Promise.all([
      db.organizationMember.count({
        where: { organizationId: context.organizationId },
      }),
      db.role.count({ where: { organizationId: context.organizationId } }),
      db.llmProvider.count({
        where: { organizationId: context.organizationId },
      }),
      db.organizationUnit.count({
        where: { organizationId: context.organizationId, active: true },
      }),
      db.organizationProject.count({
        where: { organizationId: context.organizationId, active: true },
      }),
      db.auditLog.findMany({
        where: { organizationId: context.organizationId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          action: true,
          entityName: true,
          entityType: true,
          createdAt: true,
        },
      }),
    ]);
  const metrics = [
    ["Users", users, "/workspace/admin/users"],
    ["Roles", roles, "/workspace/admin/roles"],
    ["LLM providers", providers, "/workspace/admin/providers"],
    ["Departments", units, "/workspace/admin/scopes"],
    ["Projects", projects, "/workspace/admin/scopes"],
  ] as const;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Administration"
        description="Identity, access, AI providers, privacy, and operational health for InsightKM."
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {metrics.map(([label, value, href]) => (
          <Link
            key={label}
            href={href}
            className="rounded-xl border bg-card p-5 transition hover:border-indigo-300 hover:shadow-sm"
          >
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-2 text-3xl font-semibold">{value}</p>
          </Link>
        ))}
      </section>
      <section className="rounded-xl border bg-card p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">Recent configuration activity</h2>
          <Link
            className="text-sm text-indigo-700"
            href="/workspace/admin/audit-logs"
          >
            View audit logs
          </Link>
        </div>
        <div className="divide-y">
          {recentEvents.map((event) => (
            <div
              key={event.id}
              className="flex justify-between gap-4 py-3 text-sm"
            >
              <span>
                {event.action} · {event.entityName ?? event.entityType}
              </span>
              <time className="text-muted-foreground">
                {event.createdAt.toLocaleString()}
              </time>
            </div>
          ))}
          {!recentEvents.length ? (
            <p className="py-6 text-sm text-muted-foreground">
              No activity recorded yet.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
