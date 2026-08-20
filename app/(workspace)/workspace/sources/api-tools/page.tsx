import Link from "next/link";
import { Plus, PlugZap, Search } from "lucide-react";
import type { Prisma } from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";

export const metadata = { title: "API Tools" };

function statusTone(status: string) {
  if (["READY", "COMPLETED"].includes(status)) return "success" as const;
  if (["FAILED", "DISABLED"].includes(status)) return "danger" as const;
  if (["TESTING", "PROCESSING", "NEEDS_REINDEX"].includes(status))
    return "warning" as const;
  return "neutral" as const;
}

export default async function ApiToolsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    enabled?: string;
    scope?: string;
    page?: string;
  }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "legacy_api.manage");
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = 20;
  const sourceScope =
    query.scope === "GLOBAL" || query.scope === "SELECTED_BOTS"
      ? query.scope
      : undefined;
  const where: Prisma.LegacyApiWhereInput = {
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            {
              description: {
                contains: query.q,
                mode: "insensitive" as const,
              },
            },
          ],
        }
      : {}),
    ...(query.enabled === "true"
      ? { enabled: true }
      : query.enabled === "false"
        ? { enabled: false }
        : {}),
    ...(sourceScope ? { sourceScope } : {}),
  };
  const [apis, total, enabledCount, testedCount] = await Promise.all([
    db.legacyApi.findMany({
      where,
      include: {
        _count: { select: { bots: true, invocations: true } },
      },
      orderBy: [{ enabled: "desc" }, { updatedAt: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    db.legacyApi.count({ where }),
    db.legacyApi.count({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        enabled: true,
      },
    }),
    db.legacyApi.count({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        lastTestStatus: "COMPLETED",
      },
    }),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <Link
        href="/workspace/sources"
        className="inline-flex min-h-11 items-center text-sm font-medium text-indigo-700 hover:text-indigo-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        ← All Sources
      </Link>
      <PageHeader
        eyebrow="Sources"
        title="API Tools"
        description="Manage multiple bounded, read-only API operations. Each tool has its own endpoint, authentication, schema, test history, and bot assignments."
        action={
          <Button asChild>
            <Link href="/workspace/sources/api-tools/new">
              <Plus size={17} aria-hidden="true" /> Add API Tool
            </Link>
          </Button>
        }
      />

      <section className="grid gap-4 sm:grid-cols-3" aria-label="API summary">
        {[
          ["Matching tools", total.toLocaleString()],
          ["Enabled", enabledCount.toLocaleString()],
          ["Tested successfully", testedCount.toLocaleString()],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_180px_200px_auto]">
        <label className="relative">
          <span className="sr-only">Search API tools</span>
          <Search
            size={17}
            className="pointer-events-none absolute left-3 top-3.5 text-slate-400"
            aria-hidden="true"
          />
          <input
            name="q"
            defaultValue={query.q}
            placeholder="Search name or description"
            className="min-h-11 w-full rounded-lg border bg-background pl-10 pr-3 text-sm"
          />
        </label>
        <label>
          <span className="sr-only">Enabled status</span>
          <select
            name="enabled"
            defaultValue={query.enabled ?? ""}
            className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All statuses</option>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          <span className="sr-only">Source scope</span>
          <select
            name="scope"
            defaultValue={query.scope ?? ""}
            className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="">All scopes</option>
            <option value="GLOBAL">Global</option>
            <option value="SELECTED_BOTS">Selected bots</option>
          </select>
        </label>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-medium">Tool</th>
                <th className="px-4 py-3 font-medium">Endpoint</th>
                <th className="px-4 py-3 font-medium">Scope</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 text-right font-medium">Usage</th>
                <th className="px-4 py-3 font-medium">Last test</th>
                <th className="px-4 py-3 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {apis.map((api) => (
                <tr key={api.id} className="align-top hover:bg-muted/30">
                  <td className="px-4 py-4">
                    <p className="font-semibold">{api.name}</p>
                    <p className="mt-1 max-w-64 line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {api.description}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <Badge tone="info">{api.method}</Badge>
                    <p className="mt-2 max-w-72 break-all font-mono text-xs text-muted-foreground">
                      {api.baseUrl.replace(/\/$/, "")}
                      {api.endpointPath}
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <p className="font-medium">
                      {api.sourceScope.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {api._count.bots} assigned bot(s)
                    </p>
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex flex-col items-start gap-2">
                      <Badge tone={api.enabled ? "success" : "neutral"}>
                        {api.enabled ? "ENABLED" : "DISABLED"}
                      </Badge>
                      <Badge tone={statusTone(api.sourceStatus)}>
                        {api.sourceStatus.replaceAll("_", " ")}
                      </Badge>
                    </div>
                  </td>
                  <td className="px-4 py-4 text-right">
                    {api._count.invocations.toLocaleString()} calls
                  </td>
                  <td className="px-4 py-4">
                    <Badge
                      tone={statusTone(api.lastTestStatus ?? "NOT_TESTED")}
                    >
                      {api.lastTestStatus?.replaceAll("_", " ") ?? "NOT TESTED"}
                    </Badge>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {api.lastTestedAt
                        ? api.lastTestedAt.toLocaleString()
                        : "No test run"}
                    </p>
                  </td>
                  <td className="px-4 py-4 text-right">
                    <Link
                      href={`/workspace/sources/api-tools/${api.id}/edit`}
                      className="inline-flex min-h-11 items-center rounded-lg border px-3 font-medium hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      Edit
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!apis.length ? (
          <div className="p-12 text-center">
            <PlugZap
              className="mx-auto text-slate-400"
              size={28}
              aria-hidden="true"
            />
            <h2 className="mt-3 font-semibold">No API tools found</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Add one read-only endpoint operation, then add as many additional
              tools as your bots require.
            </p>
            <Button asChild className="mt-5">
              <Link href="/workspace/sources/api-tools/new">
                <Plus size={17} aria-hidden="true" /> Add API Tool
              </Link>
            </Button>
          </div>
        ) : null}
      </section>

      {totalPages > 1 ? (
        <nav
          aria-label="API tools pagination"
          className="flex items-center justify-between gap-4"
        >
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link
                href={{ query: { ...query, page: page - 1 } }}
                className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
              >
                Previous
              </Link>
            ) : null}
            {page < totalPages ? (
              <Link
                href={{ query: { ...query, page: page + 1 } }}
                className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
              >
                Next
              </Link>
            ) : null}
          </div>
        </nav>
      ) : null}
    </div>
  );
}
