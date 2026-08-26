import type { z } from "zod";
import type { AuthorizationContext } from "@/server/auth/authorization";
import type { RetrievedKnowledge } from "@/server/services/retrieval-service";
import type { NtopActionDraft } from "@/server/services/ntop-chat-orchestrator";
import type { getEffectiveAiPrivacyPolicy } from "@/server/services/privacy-policy";

/**
 * Evidence a tool grounded its result in. Live tool output and chat
 * attachments have no indexed chunk, so `chunkId` is optional; only the rows
 * that keep one can be persisted as a knowledge citation.
 */
export type GroundingEvidence = Omit<
  RetrievedKnowledge,
  "chunkId" | "metadata"
> & {
  chunkId?: string;
  /** Widened past the retrieval row's shape: live tools carry flags and nulls. */
  metadata: Record<string, string | number | boolean | null> | null;
};

/**
 * One step of a turn's visible trace. Both the agent loop and the legacy
 * pipeline report this shape so the client renders them the same way.
 */
export type AgentTraceStep = {
  step: number;
  toolName: string;
  type: string;
  status: string;
  durationMs?: number;
  errorCode: string | null;
  /** Masked arguments the model supplied. */
  arguments: Record<string, unknown> | null;
  /** Masked result summary. */
  summary: string | null;
};

export type AgentToolKind = "SYSTEM" | "DYNAMIC";
export type AgentToolAccess = "READ" | "WRITE";
export type AgentToolGroup =
  | "DOCUMENT"
  | "HISTORY"
  | "INSIGHT"
  | "DATABASE"
  | "API"
  | "NTOP"
  | "WEB"
  | "PLATFORM";

export type AgentToolCitation = {
  kind: "DATABASE_QUERY" | "LEGACY_API";
  id: string;
  quote: string;
  metadata: Record<string, unknown>;
};

/**
 * Every tool provider returns this one shape so the agent loop can treat a
 * document search, a database query, a registered API and an NTOP lookup
 * identically instead of branching per kind.
 */
export type AgentToolResult = {
  /** Summary handed back to the model. Evidence markers are appended by the executor. */
  content: string;
  evidence: GroundingEvidence[];
  citation?: AgentToolCitation;
  /** WRITE tools never execute. They return a draft the user confirms in the UI. */
  proposal?: NtopActionDraft;
  isError: boolean;
  errorCode?: string;
};

export type AgentRunContext = {
  authorization: AuthorizationContext;
  botId: string;
  conversationId: string;
  /**
   * The user message for this turn. Excluded from history search so the agent
   * cannot retrieve the question it is currently answering.
   */
  currentMessageId: string;
  /** The raw question this turn is answering; tools that record intent reuse it. */
  userMessage: string;
  /** Retrieval bounds pinned by the request scope. */
  retrieval: {
    allAccessible: boolean;
    sourceIds: string[];
    documentIds: string[];
  };
  contextSize: number;
  timezone: string;
  /** Resolved once per turn; tools that leave the tenant boundary mask against it. */
  privacyPolicy: Awaited<ReturnType<typeof getEffectiveAiPrivacyPolicy>>;
  /** Universal chat reaches every workspace data source; a bot reaches only GLOBAL-scoped ones. */
  isUniversal: boolean;
};

export type AgentToolDefinition = {
  name: string;
  kind: AgentToolKind;
  access: AgentToolAccess;
  group: AgentToolGroup;
  /**
   * Written for the model, in Thai, and cross-referencing the neighbouring
   * tools it is most likely to be confused with. Overlapping scopes are the
   * main cause of a wrong tool choice.
   */
  description: string;
  /**
   * Set only when the name is a literal in this repository. Tenant-named tools
   * must leave it unset so the catalog's prefix guard applies to them: without
   * it a tenant could register a tool called `search_documents` and shadow the
   * platform one. Defaulting to unset keeps that guard on by default — a
   * code-defined tool that forgets the flag fails loudly at catalog build.
   */
  codeDefinedName?: boolean;
  /**
   * Set when the tool's own service already masked its output per field with
   * the organization's policy. The executor then skips its free-text pass,
   * which is deliberately crude and would mangle identifiers — a service
   * request number reads as a phone number to a digit-run regex.
   */
  selfMasked?: boolean;
  parameters: z.ZodType;
  authorize(context: AgentRunContext, args: unknown): Promise<boolean>;
  execute(context: AgentRunContext, args: unknown): Promise<AgentToolResult>;
};

/**
 * Keeps argument types checked at the definition site while every tool still
 * lands in one `Map<string, AgentToolDefinition>` the loop can dispatch from.
 */
export function defineAgentTool<Schema extends z.ZodType>(definition: {
  name: string;
  kind: AgentToolKind;
  access: AgentToolAccess;
  group: AgentToolGroup;
  description: string;
  codeDefinedName?: boolean;
  selfMasked?: boolean;
  parameters: Schema;
  authorize?(context: AgentRunContext, args: z.infer<Schema>): Promise<boolean>;
  execute(
    context: AgentRunContext,
    args: z.infer<Schema>,
  ): Promise<AgentToolResult>;
}): AgentToolDefinition {
  const { authorize, execute, ...rest } = definition;
  return {
    ...rest,
    authorize: (context, args) =>
      authorize
        ? authorize(context, args as z.infer<Schema>)
        : Promise.resolve(true),
    execute: (context, args) => execute(context, args as z.infer<Schema>),
  };
}

export function toolFailure(
  content: string,
  errorCode: string,
): AgentToolResult {
  return { content, evidence: [], isError: true, errorCode };
}

export function toolSuccess(
  content: string,
  evidence: GroundingEvidence[] = [],
  extra: Pick<AgentToolResult, "citation" | "proposal"> = {},
): AgentToolResult {
  return { content, evidence, isError: false, ...extra };
}
