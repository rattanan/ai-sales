import type {
  IndexFailureCategory,
  IndexJobStatus,
} from "@/generated/prisma/client";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { SourceRefreshPoller } from "@/components/sources/source-refresh-poller";
import {
  cancelIndexJobAction,
  retryIndexJobAction,
} from "@/features/knowledge/source-actions";
import { indexJobFilterSchema } from "@/schemas/knowledge";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { getSystemQueueMetrics } from "@/server/services/job-queue";

const statuses: IndexJobStatus[] = [
  "QUEUED",
  "PROCESSING",
  "CANCEL_REQUESTED",
  "CANCELLED",
  "COMPLETED",
  "FAILED",
  "DEAD_LETTER",
];

function statusTone(status: IndexJobStatus) {
  if (status === "COMPLETED") return "success" as const;
  if (["FAILED", "DEAD_LETTER", "CANCELLED"].includes(status))
    return "danger" as const;
  if (["PROCESSING", "CANCEL_REQUESTED"].includes(status))
    return "warning" as const;
  return "neutral" as const;
}

function duration(startedAt: Date | null, completedAt: Date | null) {
  if (!startedAt) return "—";
  const end = completedAt ?? new Date();
  return `${Math.max(0, Math.round((end.getTime() - startedAt.getTime()) / 1000))}s`;
}

export default async function IndexJobsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; sourceId?: string }>;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const rawFilters = await searchParams;
  const parsed = indexJobFilterSchema.safeParse({
    status: rawFilters.status || undefined,
    sourceId: rawFilters.sourceId || undefined,
  });
  const filters = parsed.success ? parsed.data : {};
  const sourceWhere = { rack: { organizationId: context.organizationId } };
  const [sources, jobs, databaseCounts, queueMetrics] = await Promise.all([
    db.knowledgeSource.findMany({
      where: sourceWhere,
      select: { id: true, name: true, rack: { select: { name: true } } },
      orderBy: { name: "asc" },
    }),
    db.documentIndexJob.findMany({
      where: {
        ...(filters.status ? { status: filters.status } : {}),
        documentVersion: {
          document: {
            organizationId: context.organizationId,
            ...(filters.sourceId ? { sourceId: filters.sourceId } : {}),
          },
        },
      },
      include: {
        documentVersion: {
          include: {
            document: {
              include: {
                source: { include: { rack: { select: { name: true } } } },
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    db.documentIndexJob.groupBy({
      by: ["status"],
      where: {
        documentVersion: {
          document: { organizationId: context.organizationId },
        },
      },
      _count: { _all: true },
    }),
    getSystemQueueMetrics().catch(() => null),
  ]);
  const failures = jobs.reduce<Record<string, number>>((counts, job) => {
    if (job.failureCategory)
      counts[job.failureCategory] = (counts[job.failureCategory] ?? 0) + 1;
    return counts;
  }, {});
  const completedDurations = jobs
    .filter((job) => job.startedAt && job.completedAt)
    .map((job) => job.completedAt!.getTime() - job.startedAt!.getTime());
  const averageDuration = completedDurations.length
    ? Math.round(
        completedDurations.reduce((sum, value) => sum + value, 0) /
          completedDurations.length /
          1000,
      )
    : 0;
  const count = (status: IndexJobStatus) =>
    databaseCounts.find((item) => item.status === status)?._count._all ?? 0;
  const hasActiveJobs =
    count("QUEUED") + count("PROCESSING") + count("CANCEL_REQUESTED") > 0;

  return (
    <div className="space-y-6">
      <SourceRefreshPoller active={hasActiveJobs} />
      <PageHeader
        title="Index operations"
        description="Monitor queue depth, indexing progress, categorized failures, retries, cancellation, and dead-letter jobs."
      />

      <section
        className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
        aria-label="Index metrics"
      >
        <Metric
          label="Queue depth"
          value={
            queueMetrics
              ? queueMetrics.waiting + queueMetrics.delayed
              : "Unavailable"
          }
        />
        <Metric
          label="Active workers"
          value={queueMetrics?.workers ?? "Unavailable"}
        />
        <Metric label="Processing" value={count("PROCESSING")} />
        <Metric
          label="Failed / dead-letter"
          value={count("FAILED") + count("DEAD_LETTER")}
        />
        <Metric label="Average duration" value={`${averageDuration}s`} />
      </section>

      <section className="rounded-xl border bg-card p-5">
        <form className="grid gap-4 md:grid-cols-[1fr_1fr_auto]" method="get">
          <label className="text-sm font-medium">
            Status
            <select
              name="status"
              defaultValue={filters.status ?? ""}
              className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {status.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm font-medium">
            Source
            <select
              name="sourceId"
              defaultValue={filters.sourceId ?? ""}
              className="mt-1 min-h-11 w-full rounded-lg border bg-background px-3"
            >
              <option value="">All sources</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.rack.name} · {source.name}
                </option>
              ))}
            </select>
          </label>
          <button className="min-h-11 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Apply filters
          </button>
        </form>
        {Object.keys(failures).length ? (
          <p className="mt-4 text-xs text-muted-foreground">
            Failure categories:{" "}
            {Object.entries(failures)
              .map(([key, value]) => `${key} ${value}`)
              .join(" · ")}
          </p>
        ) : null}
      </section>

      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1050px] text-left text-sm">
            <thead className="bg-muted/60 text-muted-foreground">
              <tr>
                <th className="p-3">Document</th>
                <th className="p-3">Source</th>
                <th className="p-3">Status</th>
                <th className="p-3">Progress</th>
                <th className="p-3">Attempt</th>
                <th className="p-3">Duration</th>
                <th className="p-3">Error</th>
                <th className="p-3">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {jobs.map((job) => {
                const document = job.documentVersion.document;
                const canRetry = [
                  "COMPLETED",
                  "FAILED",
                  "DEAD_LETTER",
                  "CANCELLED",
                ].includes(job.status);
                const canCancel = ["QUEUED", "PROCESSING"].includes(job.status);
                return (
                  <tr key={job.id}>
                    <td className="p-3">
                      <p className="font-medium">{document.name}</p>
                      <p className="text-xs text-muted-foreground">
                        v{job.documentVersion.version}
                      </p>
                    </td>
                    <td className="p-3">
                      {document.source.rack.name}
                      <br />
                      <span className="text-xs text-muted-foreground">
                        {document.source.name}
                      </span>
                    </td>
                    <td className="p-3">
                      <Badge tone={statusTone(job.status)}>
                        {job.status.replace("_", " ")}
                      </Badge>
                      {job.failureCategory ? (
                        <p className="mt-1 text-xs">
                          {job.failureCategory as IndexFailureCategory}
                        </p>
                      ) : null}
                    </td>
                    <td className="p-3">
                      <progress
                        aria-label={`Index progress for ${document.name}`}
                        className="h-2 w-28 accent-indigo-600"
                        max="100"
                        value={job.progressPercent}
                      />
                      <p className="text-xs text-muted-foreground">
                        {job.progressPercent}% · {job.processedChunks}/
                        {job.totalChunks ?? "?"} chunks
                      </p>
                    </td>
                    <td className="p-3">
                      {job.attempt}/{job.maxAttempts}
                    </td>
                    <td className="p-3">
                      {duration(job.startedAt, job.completedAt)}
                    </td>
                    <td className="max-w-xs p-3 text-xs text-destructive">
                      {job.errorMessage ?? "—"}
                    </td>
                    <td className="p-3">
                      {canRetry ? (
                        <form action={retryIndexJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <button className="min-h-10 rounded-lg border px-3">
                            {job.status === "COMPLETED" ? "Re-index" : "Retry"}
                          </button>
                        </form>
                      ) : null}
                      {canCancel ? (
                        <form action={cancelIndexJobAction}>
                          <input type="hidden" name="id" value={job.id} />
                          <button className="min-h-10 rounded-lg border border-red-200 px-3 text-red-700">
                            Cancel
                          </button>
                        </form>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
              {!jobs.length ? (
                <tr>
                  <td
                    colSpan={8}
                    className="p-6 text-center text-muted-foreground"
                  >
                    No index jobs match the selected filters.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
