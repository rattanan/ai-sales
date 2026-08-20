import Link from "next/link";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import {
  BotPerformanceView,
  SourcePerformanceView,
} from "@/components/analytics/performance-view";
import { TopicsTrendsView } from "@/components/analytics/topics-trends-view";
import { PageHeader } from "@/components/ui/page-header";
import {
  aggregateBotPerformance,
  aggregateSourcePerformance,
} from "@/packages/insights/performance-analysis";
import { extractInsightTopics } from "@/packages/insights/topic-analysis";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

function array(value: unknown) {
  return Array.isArray(value) ? value : [];
}
function object(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function number(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function topicItems(value: unknown) {
  return array(value).flatMap((item) => {
    const topic = object(item);
    return typeof topic.topic === "string"
      ? [{ topic: topic.topic, count: number(topic.count) }]
      : [];
  });
}

function trendItems(value: unknown) {
  return array(value).flatMap((item) => {
    const trend = object(item);
    return typeof trend.date === "string"
      ? [
          {
            date: trend.date,
            messages: number(trend.messages),
            errors: number(trend.errors),
            averageLatencyMs: number(trend.averageLatencyMs),
          },
        ]
      : [];
  });
}

export async function SnapshotSection({
  section,
}: {
  section:
    | "topics"
    | "unanswered"
    | "knowledge-gaps"
    | "bot-performance"
    | "source-performance"
    | "reports";
}) {
  const context = await requireAuthorization();
  const admin = await hasPermission(context, "role.manage");
  const jobs = await db.businessInsightJob.findMany({
    where: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      ...(!admin ? { requestedById: context.userId } : {}),
    },
    include: {
      snapshots: { orderBy: { version: "desc" }, take: 1 },
      bot: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: section === "reports" ? 50 : 1,
  });
  const snapshot = jobs[0]?.snapshots[0];
  const gaps = object(snapshot?.knowledgeGaps);
  const metrics = object(snapshot?.metrics);
  const title = (
    {
      topics: "Topics & Trends",
      unanswered: "Unanswered Questions",
      "knowledge-gaps": "Knowledge Gaps",
      "bot-performance": "Bot Performance",
      "source-performance": "Source Performance",
      reports: "Reports",
    } as const
  )[section];
  let items: unknown[] = [];
  if (section === "topics") items = array(snapshot?.topics);
  if (section === "unanswered")
    items = array(object(snapshot?.metrics).unansweredQuestions);
  if (section === "knowledge-gaps") items = array(gaps.items);
  if (section === "bot-performance")
    items = array(object(snapshot?.metrics).bots);
  if (section === "source-performance")
    items = array(object(snapshot?.metrics).sources);
  const currentTopicVersions = new Set([
    "business-insight-worker-v3",
    "business-insight-deterministic-v2",
  ]);
  const reprocessTopics = Boolean(
    section === "topics" &&
    snapshot &&
    !currentTopicVersions.has(snapshot.algorithmVersion),
  );
  if (reprocessTopics && snapshot) {
    const evidenceMessageIds = array(
      object(snapshot.evidenceAggregate).messageIds,
    ).filter((id): id is string => typeof id === "string");
    const messages = evidenceMessageIds.length
      ? await db.chatMessage.findMany({
          where: {
            id: { in: evidenceMessageIds },
            role: "USER",
            conversation: {
              organizationId: context.organizationId,
              deletedAt: null,
            },
          },
          select: { id: true, content: true },
        })
      : [];
    items = extractInsightTopics(messages);
  }
  const calculatePerformance = Boolean(
    snapshot &&
    (section === "bot-performance" || section === "source-performance"),
  );
  const evidenceMessageIds = snapshot
    ? array(object(snapshot.evidenceAggregate).messageIds).filter(
        (id): id is string => typeof id === "string",
      )
    : [];
  const performanceRows =
    calculatePerformance && evidenceMessageIds.length
      ? await db.chatMessage.findMany({
          where: {
            id: { in: evidenceMessageIds },
            role: "ASSISTANT",
            conversation: {
              organizationId: context.organizationId,
              deletedAt: null,
            },
          },
          select: {
            id: true,
            latencyMs: true,
            errorCode: true,
            feedback: { select: { rating: true } },
            citations: { select: { metadata: true } },
            conversation: {
              select: { bot: { select: { name: true } } },
            },
          },
        })
      : [];
  const performanceEvidence = performanceRows.map((message) => ({
    id: message.id,
    botName: message.conversation.bot.name,
    latencyMs: message.latencyMs,
    errorCode: message.errorCode,
    feedbackRating: message.feedback?.rating ?? null,
    citations: message.citations,
  }));
  const botPerformance = aggregateBotPerformance(performanceEvidence);
  const sourcePerformance = aggregateSourcePerformance(performanceEvidence);
  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={
          section === "reports"
            ? "Evidence-bound insight snapshot history. Open a report to inspect its exact filters, metrics, limitations, and evidence aggregates."
            : "This view reads the latest permitted evidence-bound snapshot. Generate a new snapshot when the period or scope changes."
        }
      />
      <AnalyticsNav />
      {section === "reports" ? (
        <div className="grid gap-4">
          {jobs.map((job) => (
            <article
              key={job.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-5"
            >
              <div>
                <h2 className="font-semibold">
                  {job.dateFrom.toLocaleDateString()} –{" "}
                  {job.dateTo.toLocaleDateString()}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {job.bot?.name ?? "All permitted bots"} ·{" "}
                  {job.conversationCount} conversations · {job.status}
                </p>
              </div>
              <Link
                href={`/workspace/insights?id=${job.id}`}
                className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
              >
                Open report
              </Link>
            </article>
          ))}
          {!jobs.length ? (
            <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
              No reports yet.
            </p>
          ) : null}
        </div>
      ) : (
        <section className="rounded-xl border bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">Latest permitted snapshot</h2>
            <Link
              href="/workspace/insights"
              className="min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
            >
              Generate / inspect snapshot
            </Link>
          </div>
          {snapshot ? (
            <>
              <p className="mt-2 text-sm text-muted-foreground">
                Generated {snapshot.createdAt.toLocaleString()} from{" "}
                {snapshot.conversationCount} conversations and{" "}
                {snapshot.messageCount} messages.
              </p>
              {section === "topics" ? (
                <TopicsTrendsView
                  topics={topicItems(items)}
                  trends={trendItems(snapshot.trends)}
                  questionCount={number(
                    metrics.questionCount ?? metrics.userMessageCount,
                  )}
                  reprocessed={reprocessTopics}
                />
              ) : section === "bot-performance" ? (
                <BotPerformanceView items={botPerformance} />
              ) : section === "source-performance" ? (
                <SourcePerformanceView items={sourcePerformance} />
              ) : (
                <div className="mt-5 grid gap-3 lg:grid-cols-2">
                  {items.map((item, index) => (
                    <pre
                      key={index}
                      className="overflow-auto rounded-lg bg-muted p-4 text-xs whitespace-pre-wrap"
                    >
                      {JSON.stringify(item, null, 2)}
                    </pre>
                  ))}
                  {!items.length ? (
                    <p className="text-sm text-muted-foreground">
                      No stable evidence signal for this section in the latest
                      snapshot.
                    </p>
                  ) : null}
                </div>
              )}
            </>
          ) : (
            <p className="mt-5 text-sm text-muted-foreground">
              No snapshot is available in your permitted scope.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
