import type { ChatMode, ChatScope, Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { fetchAiWithRetry } from "@/packages/ai/fetch-with-retry";
import { readChatCompletionResponse } from "@/server/ai/chat-completion-stream";
import {
  runAgentLoop,
  type AgentMessage,
  type AgentStepEvent,
} from "@/server/ai/agent/agent-loop";
import {
  buildToolCatalog,
  type ToolCatalogOptions,
} from "@/server/ai/agent/tool-registry";
import {
  AGENT_PROMPT_VERSION,
  buildAgentSystemPrompt,
} from "@/server/ai/agent/prompt";
import { buildLegacyApiTools } from "@/server/ai/agent/dynamic-tools/legacy-api";
import { buildNtopTools } from "@/server/ai/agent/dynamic-tools/ntop";
import { DEFAULT_TIMEZONE } from "@/server/ai/agent/system-tools/datetime";
import type {
  AgentRunContext,
  AgentToolDefinition,
  AgentTraceStep,
} from "@/server/ai/agent/types";
import type { ParsedChatAttachment } from "@/server/services/chat-attachment-service";
import {
  chatAttachmentEvidence,
  resolveChatProvider,
} from "@/server/services/chat-service";
import type { getEffectiveAiPrivacyPolicy } from "@/server/services/privacy-policy";
import { maskFreeText } from "@/server/services/sensitive-data";
import { activeAiEndpoint } from "@/server/services/ai-endpoint-service";
import { logger } from "@/server/services/logger";
import {
  artifactCreateRows,
  liveChatArtifact,
  storedChatArtifacts,
} from "@/server/services/chat-artifact-service";
import type { ChatArtifact } from "@/types/chat-artifact";
import { failure, success } from "@/types/result";

type AgenticLoopResult = Awaited<ReturnType<typeof runAgentLoop>>;
type AgenticEvidence = AgenticLoopResult["evidence"][number];

/** Leaves room inside the route's `maxDuration` for persistence after the loop. */
const LOOP_WALL_CLOCK_MS = 100_000;

export const REASONING_EFFORTS = ["low", "medium", "high"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

function resolvedReasoningEffort(
  requested: string | null | undefined,
  botDefault: string | null | undefined,
): ReasoningEffort | null {
  for (const candidate of [requested, botDefault]) {
    if (
      candidate &&
      (REASONING_EFFORTS as readonly string[]).includes(candidate)
    )
      return candidate as ReasoningEffort;
  }
  return null;
}

/**
 * Measured on the deployed vLLM gpt-oss endpoint: `high` reasoning consumed the
 * entire 900-token ceiling on its own and truncated the answer. The ceiling is
 * lifted with the effort so the thinking does not crowd out the reply.
 */
const EFFORT_TOKEN_MULTIPLIER: Record<ReasoningEffort, number> = {
  low: 1,
  medium: 1.5,
  high: 2.5,
};

type PrivacyPolicy = Awaited<ReturnType<typeof getEffectiveAiPrivacyPolicy>>;

export type AgenticTurnInput = {
  context: AuthorizationContext;
  bot: {
    id: string;
    systemPrompt: string;
    maxToolSteps: number;
    apiToolsEnabled: boolean;
    databaseToolsEnabled: boolean;
    disabledTools: string[];
    providerConfig: {
      providerId: string | null;
      chatEndpointId: string | null;
      model: string | null;
      temperature: number;
      maxTokens: number;
      contextSize: number;
      citationEnabled: boolean;
      memoryMode: string;
      toolMode: string;
      reasoningEffort: string | null;
    } | null;
  };
  conversation: { id: string; title: string };
  userMessage: { id: string; content: string; createdAt: Date };
  requestId: string;
  scope: ChatScope;
  mode: ChatMode;
  attachments: ParsedChatAttachment[];
  attachmentSummaries: Array<{ name: string; size: number; mimeType: string }>;
  sourceIds: string[];
  documentIds: string[];
  webSearch: boolean;
  isUniversal: boolean;
  privacyPolicy: PrivacyPolicy;
  /** Per-turn override from the chat UI; falls back to the bot's default. */
  reasoningEffort?: string | null;
  memory: Array<{ role: string; content: string }>;
  conversationSummary?: string;
  workspaceName?: string;
  departmentName?: string;
  projectName?: string;
  startedAt: number;
  onToken?: (token: string) => void | Promise<void>;
  onStepEvent?: (event: AgentStepEvent) => void;
  onArtifact?: (artifact: ChatArtifact) => void;
};

function scopeAllows(scope: ChatScope, group: "API" | "NTOP") {
  if (group === "API")
    return ["SMART", "ALL_ACCESSIBLE", "API_TOOLS"].includes(scope);
  return ["SMART", "ALL_ACCESSIBLE", "SPECIFIC_BOT"].includes(scope);
}

/**
 * Tenant-defined tools cost a query or a network round trip to enumerate, so
 * they are only resolved when the request scope could actually surface them.
 */
async function resolveDynamicTools(
  runContext: AgentRunContext,
  input: AgenticTurnInput,
): Promise<AgentToolDefinition[]> {
  const [legacyApis, ntop] = await Promise.all([
    input.bot.apiToolsEnabled && scopeAllows(input.scope, "API")
      ? buildLegacyApiTools(runContext).catch((error) => {
          logger.error("Agent legacy API tool discovery failed", {
            requestId: input.requestId,
            errorType: error instanceof Error ? error.name : typeof error,
          });
          return [] as AgentToolDefinition[];
        })
      : Promise.resolve([] as AgentToolDefinition[]),
    scopeAllows(input.scope, "NTOP")
      ? buildNtopTools(runContext).catch((error) => {
          logger.error("Agent NTOP tool discovery failed", {
            requestId: input.requestId,
            errorType: error instanceof Error ? error.name : typeof error,
          });
          return [] as AgentToolDefinition[];
        })
      : Promise.resolve([] as AgentToolDefinition[]),
  ]);
  return [...legacyApis, ...ntop];
}

/** Named so the model is told what it cannot reach, not left to guess. */
function unavailableTools(
  options: ToolCatalogOptions,
  dynamicCount: number,
): string[] {
  const missing: string[] = [];
  if (!options.webSearchRequested) missing.push("การค้นเว็บ (ผู้ใช้ปิดไว้)");
  if (!options.databaseToolsEnabled)
    missing.push("การดึงข้อมูลจากฐานข้อมูล (ปิดสำหรับบอตนี้)");
  if (!options.apiToolsEnabled) missing.push("API tools (ปิดสำหรับบอตนี้)");
  else if (!dynamicCount) missing.push("API tools (ยังไม่ได้ลงทะเบียนไว้)");
  return missing;
}

function userTurnContent(input: AgenticTurnInput) {
  const attachmentContext = maskedAttachmentContext(input);
  const question = maskFreeText(input.userMessage.content, input.privacyPolicy);
  const text = attachmentContext
    ? `ไฟล์ที่ผู้ใช้แนบมาในเทิร์นนี้:\n${attachmentContext}\n\nคำถาม:\n${question}`
    : question;
  const visualPages = input.attachments.flatMap((attachment, index) =>
    (attachment.visualPages ?? []).flatMap((page) => [
      {
        type: "text" as const,
        text: `ไฟล์แนบสแกน [${index + 1}]: ${attachment.name} หน้า ${page.page}`,
      },
      {
        type: "image_url" as const,
        image_url: { url: page.dataUrl, detail: "high" as const },
      },
    ]),
  );
  return visualPages.length
    ? [{ type: "text" as const, text }, ...visualPages]
    : text;
}

function maskedAttachmentContext(input: AgenticTurnInput) {
  return chatAttachmentEvidence(
    input.attachments,
    input.userMessage.content,
    input.bot.providerConfig?.contextSize ?? 12_000,
  )
    .map(
      (item, index) =>
        `[ไฟล์แนบ ${index + 1}] ${item.documentName}\n${maskFreeText(item.content, input.privacyPolicy)}`,
    )
    .join("\n\n");
}

export async function completeAgenticTurn(input: AgenticTurnInput) {
  const provider = await resolveChatProvider(
    input.context.organizationId,
    input.bot.providerConfig?.providerId,
    input.bot.providerConfig?.model,
    input.bot.providerConfig?.chatEndpointId,
  );
  if (!provider.model)
    return failure("AI_CONFIGURATION_ERROR", "No chat model is configured.");

  const runContext: AgentRunContext = {
    authorization: input.context,
    botId: input.bot.id,
    conversationId: input.conversation.id,
    currentMessageId: input.userMessage.id,
    userMessage: input.userMessage.content,
    retrieval: {
      allAccessible: [
        "ALL_ACCESSIBLE",
        "DOCUMENTS",
        "SPECIFIC_SOURCES",
      ].includes(input.scope),
      sourceIds: input.scope === "SPECIFIC_SOURCES" ? input.sourceIds : [],
      documentIds: input.scope === "SPECIFIC_SOURCES" ? input.documentIds : [],
    },
    contextSize: input.bot.providerConfig?.contextSize ?? 12_000,
    timezone: DEFAULT_TIMEZONE,
    privacyPolicy: input.privacyPolicy,
    isUniversal: input.isUniversal,
    displayGroundingText: [
      maskFreeText(input.userMessage.content, input.privacyPolicy),
      ...input.memory.map((message) =>
        maskFreeText(message.content, input.privacyPolicy),
      ),
      maskedAttachmentContext(input),
    ].join("\n"),
    displayArtifactCount: 0,
  };

  const reasoningEffort = (await reasoningEffortSupported(
    input.context.organizationId,
    input.bot.providerConfig?.chatEndpointId,
  ))
    ? resolvedReasoningEffort(
        input.reasoningEffort,
        input.bot.providerConfig?.reasoningEffort,
      )
    : null;
  const dynamicTools = await resolveDynamicTools(runContext, input);
  const catalogOptions: ToolCatalogOptions = {
    scope: input.scope,
    databaseToolsEnabled: input.bot.databaseToolsEnabled,
    apiToolsEnabled: input.bot.apiToolsEnabled,
    webSearchRequested: input.webSearch,
    toolMode:
      input.bot.providerConfig?.toolMode === "COMBINED"
        ? "COMBINED"
        : "SEPARATE",
    disabledTools: input.bot.disabledTools,
    dynamicTools,
  };
  const catalog = buildToolCatalog(catalogOptions);
  const maxSteps = Math.max(1, input.bot.maxToolSteps);
  const systemPrompt = buildAgentSystemPrompt({
    botPersona: input.bot.systemPrompt,
    catalog,
    unavailable: unavailableTools(
      catalogOptions,
      dynamicTools.filter((tool) => tool.group === "API").length,
    ),
    maxSteps,
    citationEnabled: input.bot.providerConfig?.citationEnabled !== false,
    runtime: {
      timezone: runContext.timezone,
      mode: input.mode,
      workspaceName: input.workspaceName,
      departmentName: input.departmentName,
      projectName: input.projectName,
      conversationSummary: input.conversationSummary,
    },
  });

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    ...(input.bot.providerConfig?.memoryMode === "NONE"
      ? []
      : input.memory.map((message) => ({
          role:
            message.role.toLowerCase() === "assistant"
              ? ("assistant" as const)
              : ("user" as const),
          content: maskFreeText(message.content, input.privacyPolicy),
        }))),
    { role: "user", content: userTurnContent(input) },
  ];

  const loop = await runAgentLoop({
    context: runContext,
    catalog,
    messages,
    maxSteps,
    deadline: performance.now() + LOOP_WALL_CLOCK_MS,
    onToken: async (token) => {
      await input.onToken?.(token);
    },
    onStepEvent: (event) => input.onStepEvent?.(event),
    // QR/chart payloads are small enough to stream immediately. Image bytes
    // wait for the final persisted response so a megabyte-scale data URL does
    // not enter the SSE channel during normal operation.
    onArtifact: (artifact) =>
      artifact.kind === "image"
        ? undefined
        : input.onArtifact?.(liveChatArtifact(artifact)),
    callProvider: async ({
      messages: turnMessages,
      tools,
      onToken,
      onReasoning,
    }) => {
      const response = await fetchAiWithRetry(
        provider.url,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(provider.apiKey
              ? { authorization: `Bearer ${provider.apiKey}` }
              : {}),
          },
          body: JSON.stringify({
            model: provider.model,
            temperature: input.bot.providerConfig?.temperature ?? 0.1,
            max_tokens: Math.round(
              (input.bot.providerConfig?.maxTokens ?? 2_048) *
                (reasoningEffort
                  ? EFFORT_TOKEN_MULTIPLIER[reasoningEffort]
                  : 1),
            ),
            stream: true,
            messages: turnMessages,
            ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
            ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
          }),
        },
        { timeoutMs: provider.timeoutMs, maxRetries: provider.maxRetries },
      );
      if (!response.ok)
        throw new Error(`Chat provider returned HTTP ${response.status}`);
      return readChatCompletionResponse(response, onToken, onReasoning);
    },
  });

  return persistAgenticTurn(input, loop, reasoningEffort);
}

/**
 * Evidence carries the marker number the model was shown ("[3]"), so a citation
 * keeps that number instead of being renumbered — otherwise the [n] written in
 * the answer points at a different source than the one stored.
 *
 * A turn can also retrieve one chunk from several tool calls, and citations are
 * unique per (message, chunk). The repeats collapse onto the first marker,
 * which is the one the model actually had in front of it.
 */
export function markeredKnowledge(evidence: AgenticEvidence[]) {
  const seen = new Set<string>();
  const rows: Array<{
    item: AgenticEvidence & { chunkId: string };
    marker: number;
  }> = [];
  evidence.forEach((item, index) => {
    if (typeof item.chunkId !== "string" || !item.chunkId) return;
    if (seen.has(item.chunkId)) return;
    seen.add(item.chunkId);
    rows.push({
      item: item as AgenticEvidence & { chunkId: string },
      marker: index + 1,
    });
  });
  return rows;
}

/** One row per distinct chunk, so repeated retrieval does not skew the gap report. */
export function retrievalTraceRows(evidence: AgenticEvidence[]) {
  const seen = new Set<string>();
  const rows: Prisma.MessageRetrievalTraceCreateWithoutMessageInput[] = [];
  evidence.forEach((item, index) => {
    const key = item.chunkId ?? `${item.sourceId}:${item.contentHash}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      sourceType:
        typeof item.metadata?.sourceType === "string"
          ? item.metadata.sourceType
          : "KNOWLEDGE_SOURCE",
      sourceId: item.sourceId,
      chunkId: item.chunkId,
      rank: index + 1,
      score: item.score,
      metadata: {
        documentId: item.documentId,
        documentName: item.documentName,
      } as Prisma.InputJsonValue,
    });
  });
  return rows;
}

async function persistAgenticTurn(
  input: AgenticTurnInput,
  loop: AgenticLoopResult,
  reasoningEffort: ReasoningEffort | null,
) {
  const citationEnabled = input.bot.providerConfig?.citationEnabled !== false;
  const failedTools = loop.traces.filter((trace) => trace.status === "FAILED");
  // A turn is only marked failed when nothing usable came back; a tool that
  // failed while the model still answered is visible in the traces instead.
  const errorCode =
    loop.errorCode ??
    (loop.content
      ? undefined
      : (failedTools[0]?.errorCode ?? "AI_PROVIDER_ERROR"));

  const knowledgeCitations = markeredKnowledge(loop.evidence);
  const retrievalRows = retrievalTraceRows(loop.evidence);

  const persisted = await db
    .$transaction(async (tx) => {
      const message = await tx.chatMessage.create({
        data: {
          conversationId: input.conversation.id,
          role: "ASSISTANT",
          content: loop.content,
          inputTokens: loop.inputTokens,
          outputTokens: loop.outputTokens,
          latencyMs: Math.round(performance.now() - input.startedAt),
          errorCode,
          requestId: input.requestId,
          scope: input.scope,
          mode: input.mode,
          promptVersion: AGENT_PROMPT_VERSION,
          toolStepCount: loop.stepsUsed,
          reasoningEffort,
          reasoningChars: loop.reasoningChars,
          scopeConfig: {
            botId: input.bot.id,
            sourceIds: input.sourceIds,
            documentIds: input.documentIds,
            webSearch: input.webSearch,
            agentic: true,
          },
          // Unlike the legacy pipeline every citation kind can appear together,
          // because one turn can now consult documents and a database and an API.
          citations: citationEnabled
            ? {
                create: [
                  ...knowledgeCitations.map(({ item, marker }) => ({
                    chunkId: item.chunkId,
                    rank: marker,
                    score: item.score,
                    quote: item.content.slice(0, 500),
                    metadata: {
                      documentId: item.documentId,
                      documentName: item.documentName,
                      mimeType: item.mimeType,
                      ...(item.metadata ?? {}),
                    } as Prisma.InputJsonValue,
                  })),
                  ...loop.citations.map((citation, index) => ({
                    ...(citation.kind === "DATABASE_QUERY"
                      ? { databaseQuery: { connect: { id: citation.id } } }
                      : {
                          legacyApiInvocation: { connect: { id: citation.id } },
                        }),
                    // Continue the numbering so no two citations share a rank.
                    rank: loop.evidence.length + index + 1,
                    score: 1,
                    quote: citation.quote,
                    metadata: citation.metadata as Prisma.InputJsonValue,
                  })),
                ],
              }
            : undefined,
          retrievalTraces: retrievalRows.length
            ? { create: retrievalRows }
            : undefined,
          reasoningSteps: loop.reasoning.length
            ? {
                create: loop.reasoning.map((round) => ({
                  stepIndex: round.step,
                  text: round.text,
                  truncated: round.truncated,
                })),
              }
            : undefined,
          toolTraces: loop.traces.length
            ? {
                create: loop.traces.map((trace) => ({
                  toolType: trace.toolType,
                  toolId: trace.toolId,
                  stepIndex: trace.stepIndex,
                  toolCallId: trace.toolCallId,
                  status: trace.status,
                  maskedInput: trace.maskedInput as Prisma.InputJsonValue,
                  maskedOutput: trace.maskedOutput as Prisma.InputJsonValue,
                  durationMs: trace.durationMs,
                  errorCode: trace.errorCode ?? null,
                })),
              }
            : undefined,
          artifacts: loop.artifacts.length
            ? { create: artifactCreateRows(loop.artifacts) }
            : undefined,
        },
        include: {
          citations: true,
          artifacts: { orderBy: { position: "asc" } },
        },
      });
      // Only the first proposal becomes an action card: the confirmation UI
      // handles one pending write at a time.
      const [draft] = loop.proposals;
      const action = draft
        ? await tx.ntopActionProposal.create({
            data: {
              organizationId: input.context.organizationId,
              userId: input.context.userId,
              conversationId: input.conversation.id,
              messageId: message.id,
              type: draft.type,
              title: draft.title,
              summary: draft.summary,
              payload: draft.payload as Prisma.InputJsonValue,
              idempotencyKey: crypto.randomUUID(),
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
            },
          })
        : null;
      await tx.conversation.update({
        where: { id: input.conversation.id },
        data: { lastMessageAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: input.context.organizationId,
          workspaceId: input.context.workspaceId,
          actorId: input.context.userId,
          action: "KNOWLEDGE_CHAT_COMPLETED",
          entityType: "Conversation",
          entityId: input.conversation.id,
          outcome: errorCode ? "FAILED" : "SUCCESS",
          requestId: input.requestId,
          metadata: {
            botId: input.bot.id,
            agentic: true,
            citationCount: message.citations.length,
            toolStepCount: loop.stepsUsed,
            toolCallCount: loop.traces.length,
            failedToolCount: failedTools.length,
            artifactCount: loop.artifacts.length,
            artifactKinds: loop.artifacts.map((artifact) => artifact.kind),
            errorCode: errorCode ?? null,
          },
        },
      });
      return { message, action };
    })
    // The answer has already streamed to the user. A storage failure must not
    // reach the error branch, which would replace text they have read; the
    // turn is reported as delivered-but-unsaved instead.
    .catch((error) => {
      logger.error("Agentic turn could not be persisted", {
        requestId: input.requestId,
        conversationId: input.conversation.id,
        errorType: error instanceof Error ? error.name : typeof error,
        // Without the driver's own code a unique-constraint failure reads the
        // same as a dropped connection in the logs.
        errorCode:
          error && typeof error === "object" && "code" in error
            ? String((error as { code: unknown }).code)
            : undefined,
        target:
          error && typeof error === "object" && "meta" in error
            ? JSON.stringify((error as { meta: unknown }).meta).slice(0, 200)
            : undefined,
      });
      return null;
    });

  const assistant = persisted?.message;
  return success({
    conversation: {
      id: input.conversation.id,
      title: input.conversation.title,
    },
    userMessage: {
      id: input.userMessage.id,
      content: input.userMessage.content,
      createdAt: input.userMessage.createdAt.toISOString(),
      attachments: input.attachmentSummaries.map(({ name }) => name),
    },
    assistantMessage: {
      // An unsaved turn keeps a recognisable id so the client can render the
      // answer without offering feedback on a row that does not exist.
      id: assistant?.id ?? `unsaved-${crypto.randomUUID()}`,
      role: "ASSISTANT" as const,
      content: assistant?.content ?? loop.content,
      createdAt: (assistant?.createdAt ?? new Date()).toISOString(),
      errorCode: assistant ? assistant.errorCode : "TURN_NOT_SAVED",
      citations: (assistant?.citations ?? []).map((citation) => ({
        id: citation.id,
        rank: citation.rank,
        score: citation.score,
        quote: citation.quote,
        metadata: citation.metadata,
      })),
      artifacts: assistant
        ? storedChatArtifacts(assistant.artifacts)
        : loop.artifacts.map(liveChatArtifact),
      reasoningTimeline: loop.reasoning.map((round) => ({
        step: round.step,
        text: round.text,
        truncated: round.truncated,
      })),
      toolTimeline: loop.traces.map<AgentTraceStep>((trace) => ({
        step: trace.stepIndex,
        toolName: trace.toolName,
        type: trace.toolType,
        status: trace.status,
        durationMs: trace.durationMs,
        errorCode: trace.errorCode ?? null,
        // Already masked and sanitized by the executor, so the asker may see
        // exactly what the model was given and what came back.
        arguments: trace.maskedInput,
        summary:
          typeof trace.maskedOutput.summary === "string"
            ? trace.maskedOutput.summary
            : null,
      })),
      suggestedAction: persisted?.action
        ? {
            id: persisted.action.id,
            type: persisted.action.type,
            status: persisted.action.status,
            title: persisted.action.title,
            summary: persisted.action.summary,
            expiresAt: persisted.action.expiresAt.toISOString(),
            errorMessage: persisted.action.errorMessage,
          }
        : undefined,
    },
  });
}

/**
 * A managed AI endpoint must declare tool-calling support before the agent
 * loop is used with it; an unmanaged provider/env configuration is assumed
 * capable, matching how the rest of the chat path treats it.
 */
/** Like tool calling, a managed endpoint must declare reasoning-effort support. */
export async function reasoningEffortSupported(
  organizationId: string,
  chatEndpointId: string | null | undefined,
) {
  const endpoint = await activeAiEndpoint(
    organizationId,
    "CHAT",
    chatEndpointId,
  );
  return endpoint ? endpoint.supportsReasoningEffort : true;
}

export async function agenticToolCallingAvailable(
  organizationId: string,
  chatEndpointId: string | null | undefined,
) {
  const endpoint = await activeAiEndpoint(
    organizationId,
    "CHAT",
    chatEndpointId,
  );
  return endpoint ? endpoint.supportsToolCalling : true;
}
