import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileText,
  History,
  RefreshCw,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteKnowledgeDialog } from "@/components/knowledge/delete-knowledge-dialog";
import { SourceFileUploadForm } from "@/components/sources/source-file-upload-form";
import { SourceReindexForm } from "@/components/sources/source-reindex-form";
import { SourceRefreshPoller } from "@/components/sources/source-refresh-poller";
import { refreshSourceAction } from "@/features/knowledge/source-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { isGoogleDriveFolderUrl } from "@/packages/knowledge/google-drive-url";

export const metadata = { title: "Knowledge source details" };

function dateTime(value: Date | null | undefined) {
  return value
    ? new Intl.DateTimeFormat("en-GB", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(value)
    : "Never";
}

function fileSize(value: number | null | undefined) {
  if (!value) return "—";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function statusTone(status: string | null | undefined) {
  if (["READY", "INDEXED", "COMPLETED"].includes(status ?? ""))
    return "success" as const;
  if (["FAILED", "CANCELLED", "DISABLED"].includes(status ?? ""))
    return "danger" as const;
  if (
    ["PROCESSING", "QUEUED", "PARTIAL", "NEEDS_REINDEX"].includes(status ?? "")
  )
    return "warning" as const;
  return "neutral" as const;
}

export default async function KnowledgeSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [{ id }, context] = await Promise.all([params, requireAuthorization()]);
  await requirePermission(context, "knowledge.manage");

  const source = await db.knowledgeSource.findFirst({
    where: {
      id,
      rack: { organizationId: context.organizationId },
    },
    include: {
      rack: { select: { name: true, description: true } },
      botAssignments: {
        include: { bot: { select: { name: true } } },
        orderBy: { priority: "asc" },
      },
      copiedTextConfig: { select: { content: true } },
      sharedFolderConfig: true,
      webConfig: true,
      documents: {
        orderBy: { updatedAt: "desc" },
        take: 100,
        include: {
          currentVersion: {
            select: {
              id: true,
              version: true,
              size: true,
              status: true,
              errorMessage: true,
              updatedAt: true,
              _count: { select: { chunks: true } },
              indexJobs: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
          versions: {
            orderBy: { version: "desc" },
            take: 1,
            select: {
              id: true,
              version: true,
              size: true,
              status: true,
              errorMessage: true,
              updatedAt: true,
              _count: { select: { chunks: true } },
              indexJobs: {
                orderBy: { createdAt: "desc" },
                take: 1,
                select: { status: true },
              },
            },
          },
        },
      },
      refreshRuns: { orderBy: { createdAt: "desc" }, take: 10 },
    },
  });
  if (!source) notFound();

  const [activeDocumentCount, indexedChunkCount] = await Promise.all([
    db.document.count({ where: { sourceId: source.id, active: true } }),
    db.documentChunk.count({
      where: {
        documentVersion: {
          currentFor: { sourceId: source.id, active: true },
        },
      },
    }),
  ]);
  const activeDocuments = source.documents.filter(
    (document) => document.active,
  );
  const visibleVersions = activeDocuments
    .map((document) => document.currentVersion ?? document.versions[0])
    .filter((version) => Boolean(version));
  const latestJobStatuses = visibleVersions
    .map((version) => version?.indexJobs[0]?.status)
    .filter((status) => Boolean(status));
  const activeJobCount = latestJobStatuses.filter((status) =>
    ["QUEUED", "PROCESSING", "CANCEL_REQUESTED"].includes(status ?? ""),
  ).length;
  const reindexableJobCount = latestJobStatuses.filter((status) =>
    ["COMPLETED", "FAILED", "DEAD_LETTER", "CANCELLED"].includes(status ?? ""),
  ).length;
  const canRefresh = source.type === "WEB" || source.type === "SHARED_FOLDER";
  const typeLabel = source.type.replaceAll("_", " ");
  const botNames = source.botAssignments.map((item) => item.bot.name);

  return (
    <div className="min-w-0 space-y-6 overflow-x-hidden">
      <SourceRefreshPoller
        active={source.refreshRuns.some((run) =>
          ["QUEUED", "PROCESSING"].includes(run.status),
        )}
      />
      <nav
        aria-label="Breadcrumb"
        className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
      >
        <Link
          href="/workspace/admin/knowledge"
          className="rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          Knowledge folders
        </Link>
        <span aria-hidden="true">/</span>
        <span>{source.rack.name}</span>
        <span aria-hidden="true">/</span>
        <span className="font-medium text-foreground" aria-current="page">
          {source.name}
        </span>
      </nav>

      <PageHeader
        eyebrow={`${source.rack.name} · ${typeLabel}`}
        title={source.name}
        description={
          source.description ?? "No description has been added for this source."
        }
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/workspace/admin/knowledge"
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-card px-4 text-sm font-semibold hover:bg-muted"
            >
              <ArrowLeft size={17} aria-hidden="true" /> Back to folders
            </Link>
            <Link
              href={`/workspace/admin/knowledge/access?source=${source.id}`}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground"
            >
              <Bot size={17} aria-hidden="true" /> Manage access
            </Link>
          </div>
        }
      />

      <div
        className="flex flex-wrap items-center gap-2"
        aria-label="Source status"
      >
        <Badge tone={statusTone(source.status)}>
          {source.status.replaceAll("_", " ")}
        </Badge>
        <Badge tone={source.active ? "success" : "danger"}>
          {source.active ? "Active" : "Disabled"}
        </Badge>
        <Badge tone={source.scope === "GLOBAL" ? "success" : "info"}>
          {source.scope === "GLOBAL"
            ? "Shared with all bots"
            : `${botNames.length} assigned bots`}
        </Badge>
      </div>

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        aria-label="Source metrics"
      >
        <Metric label="Documents" value={activeDocumentCount} />
        <Metric
          label="Indexed chunks"
          value={indexedChunkCount.toLocaleString()}
        />
        <Metric label="Last refresh" value={dateTime(source.lastRefreshAt)} />
        <Metric label="Updated" value={dateTime(source.updatedAt)} />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Source configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-4 text-sm sm:grid-cols-2">
                <Detail label="Folder" value={source.rack.name} />
                <Detail label="Type" value={typeLabel} />
                <Detail
                  label="Access"
                  value={
                    source.scope === "GLOBAL"
                      ? "All bots"
                      : botNames.join(", ") || "No bot assigned"
                  }
                />
                <Detail label="Category" value={source.category ?? "—"} />
                <Detail label="Tags" value={source.tags.join(", ") || "—"} />
                {source.webConfig ? (
                  <>
                    <Detail label="URL" value={source.webConfig.url} breakAll />
                    <Detail
                      label="Crawl limit"
                      value={`${source.webConfig.maxPages} pages · depth ${source.webConfig.crawlDepth}`}
                    />
                    <Detail
                      label="Refresh schedule"
                      value={
                        source.webConfig.scheduleEnabled
                          ? `Every ${source.webConfig.intervalMinutes} minutes`
                          : "Manual"
                      }
                    />
                  </>
                ) : null}
                {source.sharedFolderConfig ? (
                  <>
                    <Detail
                      label={
                        isGoogleDriveFolderUrl(
                          source.sharedFolderConfig.rootPath,
                        )
                          ? "Google Drive folder"
                          : "Folder path"
                      }
                      value={source.sharedFolderConfig.rootPath}
                      breakAll
                    />
                    <Detail
                      label="Subfolders"
                      value={
                        source.sharedFolderConfig.includeSubdirectories
                          ? "Included"
                          : "Not included"
                      }
                    />
                    <Detail
                      label="Refresh schedule"
                      value={
                        source.sharedFolderConfig.scheduleEnabled
                          ? `Every ${source.sharedFolderConfig.intervalMinutes} minutes`
                          : "Manual"
                      }
                    />
                  </>
                ) : null}
                {source.copiedTextConfig ? (
                  <Detail
                    label="Text length"
                    value={`${source.copiedTextConfig.content.length.toLocaleString()} characters`}
                  />
                ) : null}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Documents</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Showing up to 100 documents, most recently updated first.
              </p>
            </CardHeader>
            <CardContent>
              {activeDocuments.length ? (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-muted/60 text-muted-foreground">
                      <tr>
                        <th className="p-3 font-medium">Document</th>
                        <th className="p-3 font-medium">Status</th>
                        <th className="p-3 font-medium">Version</th>
                        <th className="p-3 font-medium">Chunks</th>
                        <th className="p-3 font-medium">Size</th>
                        <th className="p-3 font-medium">Updated</th>
                        <th className="p-3 font-medium">
                          <span className="sr-only">Open</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {activeDocuments.map((document) => {
                        const version =
                          document.currentVersion ?? document.versions[0];
                        return (
                          <tr key={document.id}>
                            <td className="p-3">
                              <p
                                className="max-w-xs truncate font-medium"
                                title={document.name}
                              >
                                {document.name}
                              </p>
                              {document.sourceLocator ? (
                                <p
                                  className="mt-0.5 max-w-xs truncate text-xs text-muted-foreground"
                                  title={document.sourceLocator}
                                >
                                  {document.sourceLocator}
                                </p>
                              ) : null}
                            </td>
                            <td className="p-3">
                              <Badge tone={statusTone(version?.status)}>
                                {version?.status ?? "NO VERSION"}
                              </Badge>
                            </td>
                            <td className="p-3">{version?.version ?? "—"}</td>
                            <td className="p-3">
                              {version?._count.chunks.toLocaleString() ?? "0"}
                            </td>
                            <td className="p-3">{fileSize(version?.size)}</td>
                            <td className="p-3">
                              {dateTime(
                                version?.updatedAt ?? document.updatedAt,
                              )}
                            </td>
                            <td className="p-3 text-right">
                              <Link
                                href={`/api/documents/${document.id}/download`}
                                aria-label={`Open ${document.name}`}
                                className="inline-grid size-11 place-items-center rounded-lg border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                              >
                                <ExternalLink size={16} aria-hidden="true" />
                              </Link>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                  <FileText
                    className="mx-auto mb-2"
                    size={28}
                    aria-hidden="true"
                  />
                  No active documents in this source yet.
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-6" aria-label="Source actions and activity">
          <Card>
            <CardHeader>
              <CardTitle>Actions</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {source.type === "FILE" ? (
                <SourceFileUploadForm sourceId={source.id} />
              ) : null}
              {canRefresh ? (
                <form action={refreshSourceAction}>
                  <input type="hidden" name="id" value={source.id} />
                  <button className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground">
                    <RefreshCw size={16} aria-hidden="true" /> Refresh source
                  </button>
                </form>
              ) : null}
              <SourceReindexForm
                sourceId={source.id}
                activeJobCount={activeJobCount}
                reindexableJobCount={reindexableJobCount}
                hasDocumentVersion={visibleVersions.length > 0}
              />
              {source.type === "COPIED_TEXT" ? (
                <Link
                  href={`/workspace/sources/copied-text/${source.id}/edit`}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold hover:bg-muted"
                >
                  <FileText size={16} aria-hidden="true" /> Edit copied text
                </Link>
              ) : null}
              <Link
                href={`/workspace/admin/knowledge/index-jobs?sourceId=${source.id}`}
                className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold hover:bg-muted"
              >
                <History size={16} aria-hidden="true" /> View index operations
              </Link>
              <DeleteKnowledgeDialog
                kind="source"
                resourceId={source.id}
                resourceName={source.name}
                documentCount={activeDocumentCount}
                redirectTo="/workspace/admin/knowledge"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent refreshes</CardTitle>
            </CardHeader>
            <CardContent>
              {source.refreshRuns.length ? (
                <ol className="space-y-4">
                  {source.refreshRuns.map((run) => (
                    <li
                      key={run.id}
                      className="border-l-2 border-slate-200 pl-3 text-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Badge tone={statusTone(run.status)}>
                          {run.status}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {dateTime(run.createdAt)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-muted-foreground">
                        {run.newCount} new · {run.changedCount} changed ·{" "}
                        {run.deletedCount} removed · {run.errorCount} failed
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No refresh history yet.
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-lg font-semibold">{value}</p>
    </div>
  );
}

function Detail({
  label,
  value,
  breakAll = false,
}: {
  label: string;
  value: React.ReactNode;
  breakAll?: boolean;
}) {
  return (
    <div className="rounded-lg bg-muted/50 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={`mt-1 font-medium ${breakAll ? "break-all" : ""}`}>
        {value}
      </dd>
    </div>
  );
}
