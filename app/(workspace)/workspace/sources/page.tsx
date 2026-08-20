import Link from "next/link";
import {
  Database,
  FileText,
  Globe2,
  PlugZap,
  Search,
  Sparkles,
  Type,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SourceAssignmentForm } from "@/components/sources/source-forms";
import { AddKnowledgeWizard } from "@/components/sources/add-knowledge-wizard";
import { KnowledgeSourceActions } from "@/components/sources/knowledge-source-actions";
import { SourceRefreshPoller } from "@/components/sources/source-refresh-poller";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { configuredGoogleDriveServiceAccountEmail } from "@/packages/knowledge/google-drive-url";

export const metadata = { title: "Manage Source" };

type UnifiedSource = {
  id: string;
  family: "KNOWLEDGE" | "DATABASE" | "API_TOOL";
  name: string;
  description: string | null;
  type: string;
  status: string;
  scope: "GLOBAL" | "SELECTED_BOTS";
  enabled: boolean;
  botIds: string[];
  botNames: string[];
  priority: number;
  documentCount: number;
  chunkCount: number;
  lastSync: Date | null;
  creator: string;
  href: string;
  previewSummary: string | null;
  refreshActive: boolean;
};

function tone(status: string) {
  if (status === "READY") return "success" as const;
  if (["FAILED", "DISABLED"].includes(status)) return "danger" as const;
  if (["TESTING", "PROCESSING", "NEEDS_REINDEX"].includes(status))
    return "warning" as const;
  return "neutral" as const;
}

function Icon({ type }: { type: string }) {
  if (type.includes("WEB")) return <Globe2 size={18} aria-hidden="true" />;
  if (
    type.includes("DATABASE") ||
    ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"].includes(type)
  )
    return <Database size={18} aria-hidden="true" />;
  if (type.includes("API")) return <PlugZap size={18} aria-hidden="true" />;
  if (type.includes("COPIED")) return <Type size={18} aria-hidden="true" />;
  return <FileText size={18} aria-hidden="true" />;
}

export default async function SourcesPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    type?: string;
    status?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  const [canKnowledge, canDatabases, canApiTools, canBots] = await Promise.all([
    hasPermission(context, "knowledge.manage"),
    hasPermission(context, "datasource.update"),
    hasPermission(context, "legacy_api.manage"),
    hasPermission(context, "bot.manage"),
  ]);
  if (!canKnowledge && !canDatabases && !canApiTools)
    throw new Error("FORBIDDEN");
  const [knowledge, databases, apiTools, bots, folders] = await Promise.all([
    canKnowledge
      ? db.knowledgeSource.findMany({
          where: { rack: { organizationId: context.organizationId } },
          include: {
            rack: true,
            createdBy: { select: { name: true, email: true } },
            botAssignments: {
              include: { bot: { select: { name: true } } },
              orderBy: { priority: "asc" },
            },
            documents: {
              where: { active: true },
              select: {
                currentVersion: {
                  select: { _count: { select: { chunks: true } } },
                },
              },
            },
            refreshRuns: {
              where: { status: { in: ["QUEUED", "PROCESSING"] } },
              select: { id: true },
              take: 1,
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 500,
        })
      : Promise.resolve([]),
    canDatabases
      ? db.dataSource.findMany({
          where: {
            workspaceId: context.workspaceId,
            type: { in: ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] },
          },
          include: {
            createdBy: { select: { name: true, email: true } },
            bots: {
              include: { bot: { select: { name: true } } },
              orderBy: { priority: "asc" },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 500,
        })
      : Promise.resolve([]),
    canApiTools
      ? db.legacyApi.findMany({
          where: {
            workspaceId: context.workspaceId,
            organizationId: context.organizationId,
          },
          include: {
            createdBy: { select: { name: true, email: true } },
            bots: {
              include: { bot: { select: { name: true } } },
              orderBy: { priority: "asc" },
            },
          },
          orderBy: { updatedAt: "desc" },
          take: 500,
        })
      : Promise.resolve([]),
    canBots
      ? db.bot.findMany({
          where: { organizationId: context.organizationId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
    canKnowledge
      ? db.knowledgeRack.findMany({
          where: { organizationId: context.organizationId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);
  const sources: UnifiedSource[] = [
    ...knowledge.map((source) => ({
      id: source.id,
      family: "KNOWLEDGE" as const,
      name: source.name,
      description: source.description ?? source.rack.description,
      type:
        source.type === "WEB" ? "WEB URL" : source.type.replaceAll("_", " "),
      status: source.status,
      scope: source.scope,
      enabled: source.active,
      botIds: source.botAssignments.map((item) => item.botId),
      botNames: source.botAssignments.map((item) => item.bot.name),
      priority: source.botAssignments[0]?.priority ?? 100,
      documentCount: source.documents.length,
      chunkCount: source.documents.reduce(
        (sum, item) => sum + (item.currentVersion?._count.chunks ?? 0),
        0,
      ),
      lastSync: source.lastRefreshAt ?? source.updatedAt,
      creator:
        source.createdBy?.name ??
        source.createdBy?.email ??
        "System / migrated",
      href:
        source.type === "COPIED_TEXT"
          ? `/workspace/sources/copied-text/${source.id}/edit`
          : `/workspace/admin/knowledge/sources/${source.id}`,
      previewSummary: source.previewSummary,
      refreshActive: source.refreshRuns.length > 0,
    })),
    ...databases.map((source) => ({
      id: source.id,
      family: "DATABASE" as const,
      name: source.name,
      description: source.description,
      type: source.type,
      status: source.sourceStatus,
      scope: source.sourceScope,
      enabled: source.sourceStatus !== "DISABLED",
      botIds: source.bots.map((item) => item.botId),
      botNames: source.bots.map((item) => item.bot.name),
      priority: source.bots[0]?.priority ?? 100,
      documentCount: 0,
      chunkCount: 0,
      lastSync: source.lastDiscoveredAt ?? source.updatedAt,
      creator: source.createdBy.name ?? source.createdBy.email,
      href: `/workspace/data-sources/${source.id}`,
      previewSummary: source.previewSummary,
      refreshActive: false,
    })),
    ...apiTools.map((source) => ({
      id: source.id,
      family: "API_TOOL" as const,
      name: source.name,
      description: source.description,
      type: "API TOOL",
      status: source.sourceStatus,
      scope: source.sourceScope,
      enabled: source.enabled,
      botIds: source.bots.map((item) => item.botId),
      botNames: source.bots.map((item) => item.bot.name),
      priority: source.bots[0]?.priority ?? 100,
      documentCount: 0,
      chunkCount: 0,
      lastSync: source.lastTestedAt ?? source.updatedAt,
      creator: source.createdBy.name ?? source.createdBy.email,
      href: `/workspace/sources/api-tools/${source.id}/edit`,
      previewSummary: source.previewSummary,
      refreshActive: false,
    })),
  ];
  const search = query.q?.trim().toLocaleLowerCase() ?? "";
  const filtered = sources.filter(
    (source) =>
      (!search ||
        `${source.name} ${source.description ?? ""} ${source.type}`
          .toLocaleLowerCase()
          .includes(search)) &&
      (!query.type ||
        query.type === "ALL" ||
        (query.type === "DATABASE"
          ? source.family === "DATABASE"
          : source.type.includes(query.type))) &&
      (!query.status ||
        query.status === "ALL" ||
        source.status === query.status),
  );
  filtered.sort((a, b) =>
    query.sort === "name"
      ? a.name.localeCompare(b.name)
      : query.sort === "status"
        ? a.status.localeCompare(b.status)
        : (b.lastSync?.getTime() ?? 0) - (a.lastSync?.getTime() ?? 0),
  );
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = 20;
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visible = filtered.slice((page - 1) * pageSize, page * pageSize);
  return (
    <div className="space-y-6">
      <SourceRefreshPoller
        active={sources.some((source) => source.refreshActive)}
      />
      <PageHeader
        title="Manage Source"
        description="Find and govern files, copied text, URLs, shared folders, live databases, and API tools in one place."
        action={
          canKnowledge ? (
            <AddKnowledgeWizard
              key={sources.length}
              folders={folders}
              bots={bots}
              googleDriveServiceAccountEmail={configuredGoogleDriveServiceAccountEmail(
                env().GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
              )}
            />
          ) : undefined
        }
      />
      <form className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_180px_180px_160px_auto]">
        <label className="relative">
          <span className="sr-only">Search sources</span>
          <Search
            className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground"
            size={17}
          />
          <input
            name="q"
            defaultValue={query.q}
            placeholder="Search name, type, or description"
            className="min-h-11 w-full rounded-lg border bg-background pl-10 pr-3 text-sm"
          />
        </label>
        <select
          name="type"
          defaultValue={query.type ?? "ALL"}
          aria-label="Filter source type"
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="ALL">All types</option>
          <option value="WEB">Web URL</option>
          <option value="FILE">File</option>
          <option value="COPIED">Copied text</option>
          <option value="DATABASE">Database</option>
          <option value="API">API tool</option>
        </select>
        <select
          name="status"
          defaultValue={query.status ?? "ALL"}
          aria-label="Filter status"
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="ALL">All statuses</option>
          {[
            "DRAFT",
            "TESTING",
            "PROCESSING",
            "READY",
            "FAILED",
            "NEEDS_REINDEX",
            "DISABLED",
          ].map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <select
          name="sort"
          defaultValue={query.sort ?? "updated"}
          aria-label="Sort sources"
          className="min-h-11 rounded-lg border bg-background px-3 text-sm"
        >
          <option value="updated">Recently updated</option>
          <option value="name">Name</option>
          <option value="status">Status</option>
        </select>
        <button className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          Apply
        </button>
      </form>
      <section className="space-y-4" aria-live="polite">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-semibold">Knowledge library</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} source(s)
          </p>
        </div>
        {visible.map((source) => (
          <article
            key={`${source.family}-${source.id}`}
            className="rounded-xl border bg-card p-5"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex min-w-0 gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                  <Icon type={source.type} />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{source.name}</h3>
                    <Badge tone={tone(source.status)}>{source.status}</Badge>
                    <Badge tone="neutral">{source.scope}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {source.type} · {source.description || "No description"}
                  </p>
                </div>
              </div>
              <Link
                href={source.href}
                className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
              >
                View / edit
              </Link>
            </div>
            {source.previewSummary ? (
              <div className="mt-4 flex items-start gap-2 rounded-lg border border-indigo-300 bg-indigo-100 px-3 py-2.5 text-indigo-950 dark:border-indigo-700 dark:bg-indigo-950 dark:text-white">
                <Sparkles
                  className="mt-0.5 shrink-0 text-indigo-700 dark:text-indigo-200"
                  size={16}
                  aria-hidden="true"
                />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-800 dark:text-indigo-200">
                    AI preview
                  </p>
                  <p className="mt-1 text-[15px] font-medium leading-6">
                    {source.previewSummary}
                  </p>
                </div>
              </div>
            ) : null}
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
              <div>
                <dt className="text-muted-foreground">Bots</dt>
                <dd className="font-medium">
                  {source.botNames.join(", ") ||
                    (source.scope === "GLOBAL"
                      ? "All authorized bots"
                      : "None")}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Documents</dt>
                <dd className="font-medium">{source.documentCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Chunks</dt>
                <dd className="font-medium">{source.chunkCount}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last sync / test</dt>
                <dd className="font-medium">
                  {source.lastSync?.toLocaleString() ?? "Never"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Creator</dt>
                <dd className="font-medium">{source.creator}</dd>
              </div>
            </dl>
            {canBots ? (
              <details className="mt-4 border-t pt-4">
                <summary className="min-h-11 cursor-pointer py-2.5 text-sm font-medium">
                  Assign bots, priority & status
                </summary>
                <div className="mt-3">
                  <SourceAssignmentForm
                    source={{
                      id: source.id,
                      type: source.family,
                      scope: source.scope,
                      enabled: source.enabled,
                      botIds: source.botIds,
                      priority: source.priority,
                    }}
                    bots={bots}
                  />
                </div>
              </details>
            ) : null}
            {source.family === "KNOWLEDGE" ? (
              <div className="mt-4 border-t pt-4">
                <KnowledgeSourceActions id={source.id} type={source.type} />
              </div>
            ) : null}
          </article>
        ))}
        {!visible.length ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center">
            <p className="font-medium">No sources match these filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Clear filters or create a copied text source.
            </p>
          </div>
        ) : null}
      </section>
      <nav
        aria-label="Source pages"
        className="flex items-center justify-between"
      >
        <Link
          aria-disabled={page <= 1}
          href={`?page=${Math.max(1, page - 1)}&q=${encodeURIComponent(query.q ?? "")}&type=${query.type ?? "ALL"}&status=${query.status ?? "ALL"}&sort=${query.sort ?? "updated"}`}
          className={`min-h-11 rounded-lg border px-4 py-2.5 text-sm ${page <= 1 ? "pointer-events-none opacity-50" : ""}`}
        >
          Previous
        </Link>
        <span className="text-sm text-muted-foreground">
          Page {Math.min(page, pageCount)} of {pageCount}
        </span>
        <Link
          aria-disabled={page >= pageCount}
          href={`?page=${Math.min(pageCount, page + 1)}&q=${encodeURIComponent(query.q ?? "")}&type=${query.type ?? "ALL"}&status=${query.status ?? "ALL"}&sort=${query.sort ?? "updated"}`}
          className={`min-h-11 rounded-lg border px-4 py-2.5 text-sm ${page >= pageCount ? "pointer-events-none opacity-50" : ""}`}
        >
          Next
        </Link>
      </nav>
    </div>
  );
}
