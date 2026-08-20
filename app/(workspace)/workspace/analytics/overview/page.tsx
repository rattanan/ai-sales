import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export const metadata = { title: "Analytics overview" };

export default async function AnalyticsOverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; botId?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  const [canAudit, admin, membership, bots] = await Promise.all([
    hasPermission(context, "chat.audit"),
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
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000);
  const from = query.from ? new Date(`${query.from}T00:00:00`) : defaultFrom;
  const to = query.to ? new Date(`${query.to}T23:59:59.999`) : now;
  const projectIds = membership?.projects.map((item) => item.projectId) ?? [];
  const conversationWhere = {
    organizationId: context.organizationId,
    deletedAt: null,
    createdAt: { gte: from, lte: to },
    ...(query.botId ? { botId: query.botId } : {}),
    ...(!canAudit
      ? { userId: context.userId }
      : !admin
        ? {
            OR: [
              ...(membership?.organizationUnitId
                ? [{ organizationUnitId: membership.organizationUnitId }]
                : []),
              ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
              { userId: context.userId },
            ],
          }
        : {}),
  };
  const [
    conversationCount,
    users,
    questions,
    assistants,
    positive,
    negative,
    toolCalls,
    latency,
    botUsage,
    tokenUsage,
  ] = await Promise.all([
    db.conversation.count({ where: conversationWhere }),
    db.conversation.groupBy({ by: ["userId"], where: conversationWhere }),
    db.chatMessage.count({
      where: { role: "USER", conversation: conversationWhere },
    }),
    db.chatMessage.groupBy({
      by: ["errorCode"],
      where: { role: "ASSISTANT", conversation: conversationWhere },
      _count: true,
    }),
    db.chatMessageFeedback.count({
      where: { rating: 1, message: { conversation: conversationWhere } },
    }),
    db.chatMessageFeedback.count({
      where: { rating: -1, message: { conversation: conversationWhere } },
    }),
    db.toolExecutionTrace.count({
      where: { message: { conversation: conversationWhere } },
    }),
    db.chatMessage.aggregate({
      where: { role: "ASSISTANT", conversation: conversationWhere },
      _avg: { latencyMs: true },
    }),
    db.conversation.groupBy({
      by: ["botId"],
      where: conversationWhere,
      _count: true,
      orderBy: { _count: { botId: "desc" } },
      take: 5,
    }),
    db.chatMessage.aggregate({
      where: { conversation: conversationWhere },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const answered = assistants
    .filter((item) => !item.errorCode)
    .reduce((sum, item) => sum + item._count, 0);
  const unanswered = assistants
    .filter((item) => item.errorCode === "NO_GROUNDED_CONTEXT")
    .reduce((sum, item) => sum + item._count, 0);
  const botNames = new Map(bots.map((bot) => [bot.id, bot.name]));
  const cards = [
    ["Conversations", conversationCount],
    ["Active users", users.length],
    ["Questions", questions],
    ["Answered", answered],
    ["Unanswered", unanswered],
    ["Positive feedback", positive],
    ["Negative feedback", negative],
    ["Avg response", `${Math.round(latency._avg.latencyMs ?? 0)} ms`],
    ["DB / API calls", toolCalls],
    [
      "Token usage",
      (tokenUsage._sum.inputTokens ?? 0) + (tokenUsage._sum.outputTokens ?? 0),
    ],
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics overview"
        description="Deterministic metrics computed from persisted conversations, feedback, tool traces, latency, and token usage. No LLM-generated numbers."
      />
      <AnalyticsNav />
      <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">From</span>
          <input
            name="from"
            type="date"
            defaultValue={from.toISOString().slice(0, 10)}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">To</span>
          <input
            name="to"
            type="date"
            defaultValue={to.toISOString().slice(0, 10)}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Bot</span>
          <select
            name="botId"
            defaultValue={query.botId ?? ""}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
          >
            <option value="">All permitted bots</option>
            {bots.map((bot) => (
              <option key={bot.id} value={bot.id}>
                {bot.name}
              </option>
            ))}
          </select>
        </label>
        <button className="min-h-11 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          Apply filters
        </button>
      </form>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(([label, value]) => (
          <section
            key={String(label)}
            className="rounded-xl border bg-card p-4"
          >
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </section>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Most used bots</h2>
        <ol className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {botUsage.map((item, index) => (
            <li key={item.botId} className="rounded-lg bg-muted p-3 text-sm">
              <span className="font-medium">
                {index + 1}. {botNames.get(item.botId) ?? "Deleted bot"}
              </span>
              <span className="mt-1 block text-muted-foreground">
                {item._count} conversations
              </span>
            </li>
          ))}
          {!botUsage.length ? (
            <li className="text-sm text-muted-foreground">
              No conversation data for this period.
            </li>
          ) : null}
        </ol>
      </section>
    </div>
  );
}
