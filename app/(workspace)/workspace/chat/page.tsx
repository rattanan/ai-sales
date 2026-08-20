import { notFound } from "next/navigation";
import { UniversalChat } from "@/components/chat/universal-chat";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { authorizeResource } from "@/server/auth/resource-authorization";

export const metadata = { title: "Universal Chat" };

export default async function ChatIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; q?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "chat.use");
  const candidateBots = await db.bot.findMany({
    where: { organizationId: context.organizationId, active: true },
    select: { id: true, name: true },
  });
  const bots: typeof candidateBots = [];
  for (const bot of candidateBots)
    try {
      await requireBotUse(context, bot.id);
      bots.push(bot);
    } catch {}
  const historyQuery = query.q?.trim().slice(0, 120) ?? "";
  const conversations = await db.conversation.findMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      isUniversal: true,
      deletedAt: null,
      ...(historyQuery
        ? { title: { contains: historyQuery, mode: "insensitive" } }
        : {}),
    },
    include: { bot: { select: { name: true } } },
    orderBy: { lastMessageAt: "desc" },
    take: 50,
  });
  const selected = query.conversation
    ? await db.conversation.findFirst({
        where: {
          id: query.conversation,
          organizationId: context.organizationId,
          userId: context.userId,
          isUniversal: true,
          deletedAt: null,
        },
        include: {
          messages: {
            where: { role: { in: ["USER", "ASSISTANT"] } },
            include: {
              citations: { orderBy: { rank: "asc" } },
              toolTraces: { orderBy: { createdAt: "desc" }, take: 1 },
              feedback: { select: { rating: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;
  if (query.conversation && !selected) notFound();
  const candidateSources = await db.knowledgeSource.findMany({
    where: {
      rack: { organizationId: context.organizationId, active: true },
      active: true,
      status: "READY",
    },
    select: { id: true, name: true, type: true, rackId: true },
    orderBy: { name: "asc" },
  });
  const sourceDecisions = await Promise.all(
    candidateSources.map(async (source) => ({
      source,
      allowed: (
        await authorizeResource(
          context,
          "KNOWLEDGE_RACK",
          source.rackId,
          "VIEW",
        )
      ).allowed,
    })),
  );
  const sources = sourceDecisions
    .filter(({ allowed }) => allowed)
    .map(({ source }) => ({
      id: source.id,
      name: source.name,
      type: source.type,
    }));
  return (
    <UniversalChat
      key={selected?.id ?? "new"}
      bots={bots}
      sources={sources.map((source) => ({
        ...source,
        type: source.type.replaceAll("_", " "),
      }))}
      conversations={conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        botName: conversation.bot.name,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      }))}
      selectedConversationId={selected?.id}
      initialMessages={(selected?.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role as "USER" | "ASSISTANT",
        content: message.content,
        errorCode: message.errorCode,
        citations: message.citations.map((citation) => ({
          id: citation.id,
          rank: citation.rank,
          quote: citation.quote,
          metadata: citation.metadata,
        })),
        toolActivity: message.toolTraces[0]
          ? {
              type: message.toolTraces[0].toolType,
              status: message.toolTraces[0].status,
            }
          : undefined,
        rating: message.feedback?.rating,
      }))}
      historyQuery={historyQuery}
    />
  );
}
