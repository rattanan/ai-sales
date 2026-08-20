import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";

export default async function SavedAnswersPage() {
  const context = await requireAuthorization();
  const answers = await db.chatMessage.findMany({
    where: {
      role: "ASSISTANT",
      conversation: {
        organizationId: context.organizationId,
        userId: context.userId,
        deletedAt: null,
      },
      feedback: { rating: 1 },
    },
    include: { conversation: true, citations: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Saved answers"
        description="Answers you marked as helpful, retained with their governed conversation and citations."
      />
      <div className="grid gap-4">
        {answers.map((answer) => (
          <article key={answer.id} className="rounded-xl border bg-card p-5">
            <p className="whitespace-pre-wrap text-sm leading-6">
              {answer.content}
            </p>
            <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3 text-xs text-muted-foreground">
              <span>
                {answer.citations.length} citation(s) ·{" "}
                {answer.createdAt.toLocaleString()}
              </span>
              <Link
                href={
                  answer.conversation.isUniversal
                    ? `/workspace/chat?conversation=${answer.conversationId}`
                    : `/workspace/chat/${answer.conversation.botId}?conversation=${answer.conversationId}`
                }
                className="min-h-10 rounded-lg border px-3 py-2.5 text-sm font-medium text-foreground"
              >
                Open conversation
              </Link>
            </div>
          </article>
        ))}
        {!answers.length ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
            No saved answers yet. Mark a helpful answer with thumbs up.
          </div>
        ) : null}
      </div>
    </div>
  );
}
