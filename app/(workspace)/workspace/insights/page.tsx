import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import {
  BusinessInsightDashboard,
  BusinessInsightForm,
  BusinessInsightStatusRefresh,
} from "@/components/insights/business-insight-workbench";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { canViewBusinessInsight } from "@/server/services/business-insight-service";
import { db } from "@/server/db";

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

export default async function BusinessInsightsPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "insight.manage");
  const [admin, membership, bots] = await Promise.all([
    hasPermission(context, "role.manage"),
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      include: { projects: true },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const projectIds =
    membership?.projects.map(({ projectId }) => projectId) ?? [];
  const [departments, projects, users, jobs] = await Promise.all([
    db.organizationUnit.findMany({
      where: {
        organizationId: context.organizationId,
        active: true,
        ...(!admin && membership?.organizationUnitId
          ? { id: membership.organizationUnitId }
          : !admin
            ? { id: { in: [] } }
            : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.organizationProject.findMany({
      where: {
        organizationId: context.organizationId,
        active: true,
        ...(!admin ? { id: { in: projectIds } } : {}),
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.organizationMember.findMany({
      where: {
        organizationId: context.organizationId,
        user: { status: "ACTIVE", deletedAt: null },
        ...(!admin
          ? {
              OR: [
                ...(membership?.organizationUnitId
                  ? [{ organizationUnitId: membership.organizationUnitId }]
                  : []),
                ...(projectIds.length
                  ? [{ projects: { some: { projectId: { in: projectIds } } } }]
                  : []),
                { userId: context.userId },
              ],
            }
          : {}),
      },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.businessInsightJob.findMany({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        ...(!admin ? { requestedById: context.userId } : {}),
      },
      include: { requestedBy: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);
  const selectedAllowed = query.id
    ? await canViewBusinessInsight(context, query.id)
    : false;
  const selected = selectedAllowed
    ? await db.businessInsightJob.findFirst({
        where: {
          id: query.id,
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
        },
        include: {
          bot: { select: { name: true } },
          organizationUnit: { select: { name: true } },
          project: { select: { name: true } },
          snapshots: { orderBy: { version: "desc" }, take: 1 },
        },
      })
    : null;
  const snapshot = selected?.snapshots[0];
  const metrics = object(snapshot?.metrics);
  const gaps = object(snapshot?.knowledgeGaps);
  return (
    <div className="space-y-6">
      <BusinessInsightStatusRefresh status={selected?.status ?? null} />
      <PageHeader
        title="Conversation business insights"
        description="Aggregate only conversations inside your permitted department/project scope. Every snapshot records its date range, filters, sample size, algorithm version, and evidence counts."
      />
      <div className="flex flex-wrap gap-3">
        <Link
          href="/workspace/insights/chat-history"
          className="min-h-11 rounded-lg border bg-card px-4 py-3 text-sm font-medium"
        >
          Audited chat history
        </Link>
      </div>
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Create insight snapshot</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Results below the minimum sample remain explicitly insufficient and do
          not generate organizational conclusions.
        </p>
        <BusinessInsightForm
          bots={bots}
          departments={departments}
          projects={projects}
          users={users.map(({ user }) => ({
            id: user.id,
            name: user.name ?? user.email,
          }))}
        />
      </section>
      <div className="grid gap-6 xl:grid-cols-[280px_1fr]">
        <aside className="rounded-xl border bg-card p-4">
          <h2 className="font-semibold">Snapshot history</h2>
          <nav
            aria-label="Business insight snapshots"
            className="mt-4 space-y-2"
          >
            {jobs.map((job) => (
              <Link
                key={job.id}
                href={`/workspace/insights?id=${job.id}`}
                className="block min-h-11 rounded-lg border p-3 text-sm hover:border-indigo-300"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {job.createdAt.toLocaleDateString()}
                  </span>
                  <Badge
                    tone={
                      job.status === "COMPLETED"
                        ? "success"
                        : job.status === "FAILED"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {job.status}
                  </Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {job.conversationCount} conversations · {job.messageCount}{" "}
                  messages
                </span>
              </Link>
            ))}
            {!jobs.length ? (
              <p className="text-sm text-muted-foreground">No snapshots yet.</p>
            ) : null}
          </nav>
        </aside>
        <main className="min-w-0 space-y-5">
          {selected && snapshot ? (
            <>
              <section className="rounded-xl border bg-slate-950 p-5 text-white">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="font-semibold">
                      Snapshot v{snapshot.version}
                    </h2>
                    <p className="mt-1 text-sm text-slate-300">
                      {selected.dateFrom.toLocaleDateString()} –{" "}
                      {selected.dateTo.toLocaleDateString()} ·{" "}
                      {selected.bot?.name ?? "All bots"} ·{" "}
                      {selected.organizationUnit?.name ??
                        "All permitted departments"}{" "}
                      · {selected.project?.name ?? "All permitted projects"}
                    </p>
                  </div>
                  <Badge tone="neutral">{snapshot.algorithmVersion}</Badge>
                </div>
                <p className="mt-4 text-sm text-slate-300">
                  Evidence sample: {snapshot.conversationCount} conversations
                  and {snapshot.messageCount} messages. Created{" "}
                  {snapshot.createdAt.toLocaleString()}.
                </p>
              </section>
              <BusinessInsightDashboard
                metrics={{
                  conversationCount: Number(metrics.conversationCount ?? 0),
                  messageCount: Number(metrics.messageCount ?? 0),
                  errorCount: Number(metrics.errorCount ?? 0),
                  errorRate: Number(metrics.errorRate ?? 0),
                  negativeFeedbackCount: Number(
                    metrics.negativeFeedbackCount ?? 0,
                  ),
                  averageLatencyMs: Number(metrics.averageLatencyMs ?? 0),
                  p95LatencyMs: Number(metrics.p95LatencyMs ?? 0),
                }}
                trends={array(snapshot.trends) as never}
                topics={array(snapshot.topics) as never}
                knowledgeGaps={{
                  count: Number(gaps.count ?? 0),
                  items: array(gaps.items) as never,
                }}
                findings={array(snapshot.findings) as never}
                limitations={snapshot.limitations}
              />
            </>
          ) : (
            <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              Select or create a snapshot to review its evidence-bound findings.
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
