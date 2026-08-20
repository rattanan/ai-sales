import Link from "next/link";
import { AnalyticsNav } from "@/components/analytics/analytics-nav";
import { PageHeader } from "@/components/ui/page-header";
import { createKnowledgeGapFormAction } from "@/features/insights/knowledge-gap-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function UnansweredPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "insight.manage");
  const [canAudit, admin, membership] = await Promise.all([
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
  ]);
  const projectIds =
    membership?.projects.map(({ projectId }) => projectId) ?? [];
  const conversationWhere = {
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
              ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
              { userId: context.userId },
            ],
          }
        : {}),
  };
  const answers = await db.chatMessage.findMany({
    where: {
      role: "ASSISTANT",
      errorCode: { not: null },
      conversation: conversationWhere,
    },
    include: {
      conversation: {
        include: {
          bot: { select: { id: true, name: true } },
          messages: { where: { role: "USER" }, orderBy: { createdAt: "asc" } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Unanswered Questions"
        description="Persisted unanswered turns in your permitted conversation scope. Convert evidence into a trackable knowledge-gap workflow."
      />
      <AnalyticsNav />
      <div className="space-y-4">
        {answers.map((answer) => {
          const question = [...answer.conversation.messages]
            .reverse()
            .find((message) => message.createdAt <= answer.createdAt);
          return (
            <article key={answer.id} className="rounded-xl border bg-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700">
                {answer.errorCode}
              </p>
              <h2 className="mt-1 font-semibold">
                {question?.content ?? "Related question unavailable"}
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {answer.conversation.bot.name} ·{" "}
                {answer.createdAt.toLocaleString()}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                <Link
                  href={`/workspace/insights/chat-history?reason=${encodeURIComponent("Investigate unanswered question")}&q=${encodeURIComponent(question?.content ?? "")}`}
                  className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
                >
                  Open conversation evidence
                </Link>
                <form action={createKnowledgeGapFormAction}>
                  <input type="hidden" name="messageId" value={answer.id} />
                  <button className="min-h-11 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">
                    Create knowledge gap
                  </button>
                </form>
                <Link
                  href={`/workspace/admin/bots/${answer.conversation.bot.id}?tab=playground`}
                  className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
                >
                  Open playground
                </Link>
              </div>
            </article>
          );
        })}
        {!answers.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
            No unanswered turns in your permitted scope.
          </p>
        ) : null}
      </div>
    </div>
  );
}
