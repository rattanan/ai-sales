import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";
import Link from "next/link";

export default async function AuditLogsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    action?: string;
    outcome?: string;
    page?: string;
  }>;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "audit.view");
  const canExport = await hasPermission(context, "audit.export");
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const logs = await db.auditLog.findMany({
    where: {
      organizationId: context.organizationId,
      ...(query.q
        ? {
            OR: [
              { action: { contains: query.q, mode: "insensitive" } },
              { entityName: { contains: query.q, mode: "insensitive" } },
              { actorName: { contains: query.q, mode: "insensitive" } },
            ],
          }
        : {}),
      ...(query.action ? { action: query.action } : {}),
      ...(query.outcome ? { outcome: query.outcome } : {}),
    },
    include: { actor: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 25,
    take: 25,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit logs"
        description="Immutable security and business events. Sensitive fields are recursively redacted before persistence."
        action={
          canExport ? (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border bg-white px-4 text-sm font-medium"
              href="/api/admin/audit-logs/export"
            >
              Export CSV
            </Link>
          ) : undefined
        }
      />
      <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_220px_180px_auto]">
        <input
          name="q"
          defaultValue={query.q}
          placeholder="Search action, resource, or user"
          className="min-h-11 rounded-lg border px-3"
        />
        <input
          name="action"
          defaultValue={query.action}
          placeholder="Exact action"
          className="min-h-11 rounded-lg border px-3"
        />
        <select
          name="outcome"
          defaultValue={query.outcome ?? ""}
          className="min-h-11 rounded-lg border bg-white px-3"
        >
          <option value="">All outcomes</option>
          <option>SUCCESS</option>
          <option>FAILED</option>
          <option>DENIED</option>
        </select>
        <button className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
          Filter
        </button>
      </form>
      <div className="space-y-3">
        {logs.map((log) => (
          <details key={log.id} className="group rounded-xl border bg-card p-4">
            <summary className="grid cursor-pointer list-none gap-3 sm:grid-cols-[190px_1fr_160px_120px] sm:items-center">
              <time className="text-sm text-muted-foreground">
                {log.createdAt.toLocaleString()}
              </time>
              <div>
                <p className="font-medium">{log.action}</p>
                <p className="text-xs text-muted-foreground">
                  {log.entityType} · {log.entityName ?? log.entityId ?? "—"}
                </p>
              </div>
              <p className="text-sm">
                {log.actor?.name ?? log.actorName ?? "System"}
              </p>
              <Badge
                tone={
                  log.outcome === "SUCCESS"
                    ? "success"
                    : log.outcome === "DENIED"
                      ? "warning"
                      : "danger"
                }
              >
                {log.outcome}
              </Badge>
            </summary>
            <div className="mt-4 grid gap-4 border-t pt-4 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  Before
                </h3>
                <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(log.beforeValue, null, 2) || "—"}
                </pre>
              </div>
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                  After
                </h3>
                <pre className="overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(log.afterValue, null, 2) || "—"}
                </pre>
              </div>
              <p className="text-xs text-muted-foreground lg:col-span-2">
                Correlation: {log.correlationId ?? log.requestId ?? "—"} · IP:{" "}
                {log.ipAddress ?? "—"}
              </p>
            </div>
          </details>
        ))}
        {!logs.length ? (
          <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            No audit events match these filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
