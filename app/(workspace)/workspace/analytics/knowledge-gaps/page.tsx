import Link from "next/link";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { PageHeader } from "@/components/ui/page-header";
import {
  createKnowledgeGapFormAction,
  updateKnowledgeGapFormAction,
} from "@/features/insights/knowledge-gap-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export default async function KnowledgeGapsPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "insight.manage");
  const [admin, canAudit, membership, users] = await Promise.all([
    hasPermission(context, "role.manage"),
    hasPermission(context, "chat.audit"),
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      include: { projects: true },
    }),
    db.organizationMember.findMany({
      where: {
        organizationId: context.organizationId,
        user: { status: "ACTIVE", deletedAt: null },
      },
      select: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  const projects = membership?.projects.map(({ projectId }) => projectId) ?? [];
  const allowedMessages = await db.chatMessage.findMany({
    where: {
      conversation: {
        organizationId: context.organizationId,
        deletedAt: null,
        ...(!canAudit
          ? { userId: context.userId }
          : !admin
            ? {
                OR: [
                  ...(membership?.organizationUnitId
                    ? [{ organizationUnitId: membership.organizationUnitId }]
                    : []),
                  ...(projects.length ? [{ projectId: { in: projects } }] : []),
                  { userId: context.userId },
                ],
              }
            : {}),
      },
    },
    select: { id: true },
    take: 10000,
  });
  const allowedMessageIds = allowedMessages.map(({ id }) => id);
  const [gaps, latestJob] = await Promise.all([
    db.knowledgeGap.findMany({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        evidenceMessageIds: { hasSome: allowedMessageIds },
      },
      include: { assignee: { select: { name: true, email: true } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
      take: 200,
    }),
    db.businessInsightJob.findFirst({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        ...(!admin ? { requestedById: context.userId } : {}),
      },
      include: { snapshots: { orderBy: { version: "desc" }, take: 1 } },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const allowedSet = new Set(allowedMessageIds);
  const snapshot = latestJob?.snapshots[0];
  const detectedByTopic = new Map<
    string,
    { count: number; messageIds: string[] }
  >();
  for (const item of array(object(snapshot?.knowledgeGaps).items)) {
    const gap = object(item);
    if (typeof gap.topic !== "string") continue;
    const messageIds = array(gap.messageIds).filter(
      (id): id is string => typeof id === "string" && allowedSet.has(id),
    );
    if (!messageIds.length) continue;
    const current = detectedByTopic.get(gap.topic) ?? {
      count: 0,
      messageIds: [],
    };
    current.count +=
      typeof gap.count === "number" && Number.isFinite(gap.count)
        ? gap.count
        : messageIds.length;
    current.messageIds.push(...messageIds);
    detectedByTopic.set(gap.topic, current);
  }
  const detectedGaps = [...detectedByTopic.entries()].map(
    ([topic, values]) => ({
      topic,
      count: values.count,
      messageIds: [...new Set(values.messageIds)],
    }),
  );
  const trackedEvidence = new Set(
    gaps.flatMap((gap) => gap.evidenceMessageIds),
  );
  return (
    <div className="space-y-6">
      <PageHeader
        title="Knowledge Gaps"
        description="Assign, resolve, and connect evidence-bound gaps to new or improved sources without weakening conversation ACL."
      />
      <AnalyticsNav />
      <section className="rounded-xl border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-semibold">Detected in latest snapshot</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Evidence signals appear here before they are promoted into the
              managed workflow below.
            </p>
          </div>
          <Link
            href="/workspace/insights"
            className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            Generate / inspect snapshot
          </Link>
        </div>
        {detectedGaps.length ? (
          <div className="mt-5 grid gap-4 lg:grid-cols-2">
            {detectedGaps.map((gap) => {
              const tracked = gap.messageIds.some((id) =>
                trackedEvidence.has(id),
              );
              const label =
                gap.topic === "no grounded context"
                  ? "Missing grounded context"
                  : gap.topic;
              return (
                <article
                  key={gap.topic}
                  className="rounded-xl border border-amber-200 bg-amber-50 p-4"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                        Snapshot signal
                      </p>
                      <h3 className="mt-1 font-semibold text-amber-950">
                        {label}
                      </h3>
                    </div>
                    <span className="rounded-full bg-white px-2.5 py-1 text-sm font-semibold text-amber-800">
                      {gap.count}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-amber-900">
                    {gap.messageIds.length} permitted evidence message
                    {gap.messageIds.length === 1 ? "" : "s"}
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link
                      href={`/workspace/insights/chat-history?reason=${encodeURIComponent("Investigate detected knowledge gap")}&q=${encodeURIComponent(label)}`}
                      className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 py-2.5 text-sm font-medium"
                    >
                      Review evidence
                    </Link>
                    {tracked ? (
                      <span className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-emerald-700">
                        Already tracked
                      </span>
                    ) : (
                      <form action={createKnowledgeGapFormAction}>
                        <input
                          type="hidden"
                          name="messageId"
                          value={gap.messageIds[0]}
                        />
                        <button className="min-h-11 rounded-lg bg-amber-900 px-3 text-sm font-medium text-white">
                          Create workflow
                        </button>
                      </form>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="mt-5 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
            The latest permitted snapshot contains no classified knowledge-gap
            signal.
          </p>
        )}
      </section>
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="font-semibold">Managed workflow</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Assign ownership and track remediation through resolution.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">{gaps.length} tracked</p>
      </div>
      <div className="space-y-4">
        {gaps.map((gap) => (
          <article key={gap.id} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                  {gap.priority} · {gap.status}
                </p>
                <h2 className="mt-1 font-semibold">{gap.title}</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {gap.question}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                {gap.evidenceMessageIds.length} evidence messages
              </p>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link
                href={`/workspace/insights/chat-history?reason=${encodeURIComponent("Resolve knowledge gap")}&q=${encodeURIComponent(gap.question)}`}
                className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
              >
                Open evidence
              </Link>
              <Link
                href="/workspace/sources/copied-text/new"
                className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
              >
                Create copied text
              </Link>
              <Link
                href="/workspace/sources/file-upload"
                className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
              >
                Upload document
              </Link>
              <Link
                href="/workspace/sources"
                className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
              >
                Assign source to bot
              </Link>
            </div>
            <form
              action={updateKnowledgeGapFormAction}
              className="mt-4 grid gap-3 border-t pt-4 sm:grid-cols-[1fr_180px_auto]"
            >
              <input type="hidden" name="id" value={gap.id} />
              <label className="text-sm">
                <span className="mb-1 block font-medium">Assignee</span>
                <select
                  name="assigneeId"
                  defaultValue={gap.assigneeId ?? ""}
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="">Unassigned</option>
                  {users.map(({ user }) => (
                    <option key={user.id} value={user.id}>
                      {user.name ?? user.email}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium">Status</span>
                <select
                  name="status"
                  defaultValue={gap.status}
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="OPEN">Open</option>
                  <option value="IN_PROGRESS">In progress</option>
                  <option value="RESOLVED">Resolved</option>
                </select>
              </label>
              <button className="min-h-11 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
                Save workflow
              </button>
            </form>
          </article>
        ))}
        {!gaps.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No detected gap has been promoted into the managed workflow yet.
          </p>
        ) : null}
      </div>
    </div>
  );
}
