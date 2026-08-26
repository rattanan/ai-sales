import { notFound } from "next/navigation";
import { KnowledgeChat } from "@/components/chat/knowledge-chat";
import { chatAttachmentNames } from "@/lib/chat-attachments";
import { requireAuthorization } from "@/server/auth/authorization";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { storedChatArtifacts } from "@/server/services/chat-artifact-service";

function stringQuestions(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function citationMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function KnowledgeChatPage({
  params,
  searchParams,
}: {
  params: Promise<{ botId: string }>;
  searchParams: Promise<{
    conversation?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const [{ botId }, query, context] = await Promise.all([
    params,
    searchParams,
    requireAuthorization(),
  ]);
  await requireBotUse(context, botId).catch(() => notFound());
  const historyPage = Math.max(1, Number(query.page) || 1);
  const historyQuery = query.q?.trim().slice(0, 120) ?? "";
  const conversationWhere = {
    botId,
    userId: context.userId,
    organizationId: context.organizationId,
    deletedAt: null,
    ...(historyQuery
      ? { title: { contains: historyQuery, mode: "insensitive" as const } }
      : {}),
  };
  const [bot, conversations, conversationCount, membership] = await Promise.all(
    [
      db.bot.findFirst({
        where: { id: botId, organizationId: context.organizationId },
      }),
      db.conversation.findMany({
        where: conversationWhere,
        orderBy: { lastMessageAt: "desc" },
        skip: (historyPage - 1) * 25,
        take: 25,
      }),
      db.conversation.count({ where: conversationWhere }),
      db.organizationMember.findUnique({
        where: {
          organizationId_userId: {
            organizationId: context.organizationId,
            userId: context.userId,
          },
        },
        include: {
          projects: {
            where: { project: { active: true } },
            include: { project: { select: { id: true, name: true } } },
          },
        },
      }),
    ],
  );
  if (!bot) notFound();
  const selectedId = query.conversation;
  const selected = selectedId
    ? await db.conversation.findFirst({
        where: {
          id: selectedId,
          botId,
          userId: context.userId,
          organizationId: context.organizationId,
          deletedAt: null,
        },
        include: {
          messages: {
            where: { role: { in: ["USER", "ASSISTANT"] } },
            include: {
              citations: { orderBy: { rank: "asc" } },
              artifacts: { orderBy: { position: "asc" } },
              feedback: true,
              ntopActions: { orderBy: { createdAt: "desc" }, take: 1 },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      })
    : null;
  if (selectedId && !selected) notFound();
  return (
    <KnowledgeChat
      bot={{
        id: bot.id,
        name: bot.name,
        welcomeMessage: bot.welcomeMessage,
        suggestedQuestions: stringQuestions(bot.suggestedQuestions),
      }}
      conversations={conversations.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        lastMessageAt: conversation.lastMessageAt.toISOString(),
      }))}
      historyQuery={historyQuery}
      historyPage={historyPage}
      historyPages={Math.max(1, Math.ceil(conversationCount / 25))}
      selectedConversationId={selected?.id}
      initialMessages={(selected?.messages ?? []).map((message) => ({
        id: message.id,
        role: message.role as "USER" | "ASSISTANT",
        content: message.content,
        artifacts: storedChatArtifacts(message.artifacts),
        attachments: chatAttachmentNames(message.scopeConfig),
        errorCode: message.errorCode,
        rating: message.feedback?.rating,
        suggestedAction: message.ntopActions[0]
          ? {
              id: message.ntopActions[0].id,
              type: message.ntopActions[0].type,
              status: message.ntopActions[0].status,
              title: message.ntopActions[0].title,
              summary: message.ntopActions[0].summary,
              expiresAt: message.ntopActions[0].expiresAt.toISOString(),
              errorMessage: message.ntopActions[0].errorMessage,
            }
          : undefined,
        citations: message.citations.map((citation) => ({
          id: citation.id,
          rank: citation.rank,
          score: citation.score,
          quote: citation.quote,
          metadata: citationMetadata(citation.metadata),
        })),
      }))}
      projects={membership?.projects.map(({ project }) => project) ?? []}
      webSearchAvailable={Boolean(
        env().WEB_SEARCH_ENABLED && env().WEB_SEARCH_API_KEY,
      )}
    />
  );
}
