import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";
import Link from "next/link";

export default async function LoginHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "login_history.view");
  const canExport = await hasPermission(context, "login_history.export");
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const where = {
    organizationId: context.organizationId,
    ...(query.q
      ? {
          OR: [
            { identifier: { contains: query.q, mode: "insensitive" as const } },
            { ipAddress: { contains: query.q } },
            { browser: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.status
      ? { status: query.status as "SUCCESS" | "FAILED" | "LOCKED" | "LOGOUT" }
      : {}),
  };
  const events = await db.loginHistory.findMany({
    where,
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * 25,
    take: 25,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Login history"
        description="Successful and failed authentication events, account locks, devices, and sessions."
        action={
          canExport ? (
            <Link
              className="inline-flex min-h-11 items-center rounded-lg border bg-white px-4 text-sm font-medium"
              href="/api/admin/login-history/export"
            >
              Export CSV
            </Link>
          ) : undefined
        }
      />
      <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_220px_auto]">
        <input
          name="q"
          defaultValue={query.q}
          placeholder="User, IP, or browser"
          className="min-h-11 rounded-lg border px-3"
        />
        <select
          name="status"
          defaultValue={query.status ?? ""}
          className="min-h-11 rounded-lg border bg-white px-3"
        >
          <option value="">All events</option>
          <option>SUCCESS</option>
          <option>FAILED</option>
          <option>LOCKED</option>
        </select>
        <button className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
          Filter
        </button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50">
            <tr>
              {[
                "Time",
                "User",
                "Status",
                "IP",
                "Client",
                "Failure",
                "Logout",
              ].map((x) => (
                <th key={x} className="px-4 py-3">
                  {x}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id} className="border-b last:border-0">
                <td className="whitespace-nowrap px-4 py-3">
                  {event.createdAt.toLocaleString()}
                </td>
                <td className="px-4">
                  <p>{event.user?.name ?? "Unknown"}</p>
                  <p className="text-xs text-muted-foreground">
                    {event.identifier}
                  </p>
                </td>
                <td className="px-4">
                  <Badge
                    tone={
                      event.status === "SUCCESS"
                        ? "success"
                        : event.status === "LOCKED"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {event.status}
                  </Badge>
                </td>
                <td className="px-4">{event.ipAddress ?? "—"}</td>
                <td className="px-4">
                  {event.browser} · {event.operatingSystem}
                  <span className="block text-xs text-muted-foreground">
                    {event.device}
                  </span>
                </td>
                <td className="px-4">{event.failureReason ?? "—"}</td>
                <td className="px-4">
                  {event.logoutAt?.toLocaleString() ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!events.length ? (
          <p className="p-8 text-center text-muted-foreground">
            No login events match these filters.
          </p>
        ) : null}
      </div>
    </div>
  );
}
