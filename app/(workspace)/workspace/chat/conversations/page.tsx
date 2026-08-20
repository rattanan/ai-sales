import Link from "next/link";
import { MessageCirclePlus, MessagesSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";

export const metadata = { title: "Conversations" };

export default async function ConversationsPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "chat.use");
  const conversations = await db.conversation.findMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      deletedAt: null,
    },
    include: {
      bot: { select: { name: true } },
      messages: {
        where: { role: "ASSISTANT" },
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { content: true },
      },
      _count: { select: { messages: true } },
    },
    orderBy: { lastMessageAt: "desc" },
    take: 100,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Conversations"
        description="Resume your Universal Chat and bot conversations with their original access scope and evidence."
        action={
          <Button asChild>
            <Link href="/workspace/chat">
              <MessageCirclePlus size={17} aria-hidden="true" /> New chat
            </Link>
          </Button>
        }
      />
      <section className="grid gap-3">
        {conversations.map((conversation) => (
          <Link
            key={conversation.id}
            href={
              conversation.isUniversal
                ? `/workspace/chat?conversation=${conversation.id}`
                : `/workspace/chat/${conversation.botId}?conversation=${conversation.id}`
            }
            className="group rounded-xl border bg-card p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 motion-reduce:transition-none"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="truncate font-semibold group-hover:text-indigo-900">
                    {conversation.title}
                  </h2>
                  <Badge tone={conversation.isUniversal ? "info" : "neutral"}>
                    {conversation.isUniversal ? "UNIVERSAL" : "BOT"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {conversation.bot.name} · {conversation._count.messages}{" "}
                  messages
                </p>
              </div>
              <time className="text-xs text-muted-foreground">
                {conversation.lastMessageAt.toLocaleString()}
              </time>
            </div>
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">
              {conversation.messages[0]?.content ??
                "Open this conversation to continue."}
            </p>
          </Link>
        ))}
        {!conversations.length ? (
          <div className="rounded-xl border border-dashed bg-card p-10 text-center">
            <MessagesSquare
              className="mx-auto text-slate-400"
              aria-hidden="true"
            />
            <h2 className="mt-3 font-semibold">No conversations yet</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a new chat and your history will appear here.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
