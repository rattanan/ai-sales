import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { UniversalChat } from "@/components/chat/universal-chat";
import { chatAttachmentNames } from "@/lib/chat-attachments";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { env } from "@/schemas/env";
import { isThinkLevel, THINK_LEVEL_COOKIE } from "@/lib/chat-preferences";
import { storedChatArtifacts } from "@/server/services/chat-artifact-service";

/**
 * Traces predating the agent loop stored no tool name, so the tool group is
 * used as the label rather than rendering an empty step.
 */
function traceToolName(maskedInput: unknown, toolType: string) {
  if (
    maskedInput &&
    typeof maskedInput === "object" &&
    "toolName" in maskedInput
  ) {
    const name = (maskedInput as { toolName: unknown }).toolName;
    if (typeof name === "string" && name) return name;
  }
  return toolType.toLowerCase();
}

function traceSummary(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const summary = (value as { summary?: unknown }).summary;
  return typeof summary === "string" ? summary : null;
}

function citationMetadata(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

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
  const savedThinkLevel = (await cookies()).get(THINK_LEVEL_COOKIE)?.value;
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
              artifacts: { orderBy: { position: "asc" } },
              toolTraces: {
                orderBy: [{ stepIndex: "asc" }, { createdAt: "asc" }],
              },
              reasoningSteps: { orderBy: { stepIndex: "asc" } },
              feedback: { select: { rating: true } },
              ntopActions: { orderBy: { createdAt: "desc" }, take: 1 },
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
    select: {
      id: true,
      name: true,
      type: true,
      rackId: true,
      rack: { select: { name: true } },
      documents: {
        where: {
          active: true,
          currentVersion: { status: "INDEXED" },
        },
        select: { id: true, name: true, mimeType: true },
        orderBy: { name: "asc" },
      },
    },
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
    .filter(({ allowed, source }) => allowed && source.documents.length > 0)
    .map(({ source }) => ({
      id: source.id,
      name: source.name,
      type: source.type,
      folderId: source.rackId,
      folderName: source.rack.name,
      documents: source.documents,
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
        artifacts: storedChatArtifacts(message.artifacts),
        attachments: chatAttachmentNames(message.scopeConfig),
        errorCode: message.errorCode,
        citations: message.citations.map((citation) => ({
          id: citation.id,
          rank: citation.rank,
          quote: citation.quote,
          metadata: citationMetadata(citation.metadata),
        })),
        reasoningTimeline: message.reasoningSteps.map((round) => ({
          step: round.stepIndex,
          text: round.text,
          truncated: round.truncated,
        })),
        toolTimeline: message.toolTraces.map((trace, index) => ({
          step: trace.stepIndex ?? index,
          toolName: traceToolName(trace.maskedInput, trace.toolType),
          type: trace.toolType,
          status: trace.status,
          durationMs: trace.durationMs ?? undefined,
          errorCode: trace.errorCode,
          arguments: citationMetadata(trace.maskedInput),
          summary: traceSummary(trace.maskedOutput),
        })),
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
      }))}
      historyQuery={historyQuery}
      initialThinkLevel={
        isThinkLevel(savedThinkLevel) ? savedThinkLevel : "DEFAULT"
      }
      webSearchAvailable={Boolean(
        env().WEB_SEARCH_ENABLED && env().WEB_SEARCH_API_KEY,
      )}
    />
  );
}
