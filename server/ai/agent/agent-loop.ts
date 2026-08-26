import {
  EmptyChatAnswerError,
  type ChatAnswer,
  type ToolCall,
} from "@/server/ai/chat-completion-stream";
import type { NtopActionDraft } from "@/server/services/ntop-chat-orchestrator";
import {
  executeToolCall,
  type ExecutedTool,
  type ToolTrace,
} from "@/server/ai/agent/tool-executor";
import { toolCatalogPayload } from "@/server/ai/agent/tool-registry";
import type {
  AgentRunContext,
  GeneratedChatArtifact,
  AgentToolCitation,
  AgentToolDefinition,
  GroundingEvidence,
} from "@/server/ai/agent/types";
import { appendDisplayGrounding } from "@/server/ai/display-artifacts/grounding";

export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | unknown[] }
  | {
      role: "assistant";
      content: string;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    }
  | { role: "tool"; tool_call_id: string; name: string; content: string };

/**
 * What the turn did, in the order it happened. The client renders this as the
 * turn's visible trace, so reasoning and tool activity share one stream rather
 * than arriving on separate channels the UI would have to re-order.
 */
export type AgentStepEvent =
  | { kind: "reasoning"; step: number; delta: string }
  | {
      kind: "tool_start";
      step: number;
      toolCallId: string;
      toolName: string;
      arguments: Record<string, unknown>;
    }
  | {
      kind: "tool_end";
      step: number;
      toolCallId: string;
      toolName: string;
      isError: boolean;
      errorCode?: string;
      durationMs: number;
      /** Masked, sanitized result summary — safe to show the asker. */
      summary: string;
    };

export type AgentProviderCall = (input: {
  messages: AgentMessage[];
  tools?: ReturnType<typeof toolCatalogPayload>;
  onToken?: (token: string) => void | Promise<void>;
  onReasoning?: (delta: string) => void | Promise<void>;
}) => Promise<ChatAnswer>;

export type ReasoningRound = {
  step: number;
  text: string;
  /** The round ran past `MAX_STORED_REASONING_CHARS` and was cut. */
  truncated: boolean;
};

export type AgentLoopResult = {
  content: string;
  evidence: GroundingEvidence[];
  citations: AgentToolCitation[];
  proposals: NtopActionDraft[];
  artifacts: GeneratedChatArtifact[];
  traces: ToolTrace[];
  stepsUsed: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Total chain-of-thought characters across every pass this turn. */
  reasoningChars?: number;
  /** Chain of thought per round, in order, for the saved trace. */
  reasoning: ReasoningRound[];
  finishReason?: string;
  errorCode?: string;
};

/**
 * Per-round cap on the chain of thought kept for storage. `high` effort can
 * think for pages, and a turn holds one of these per round; the stored trace is
 * there to show how the answer was reached, not to archive the model's every
 * word. `reasoningChars` still records the full length.
 */
const MAX_STORED_REASONING_CHARS = 4_000;

const SUMMARIZE_TOOL_RESULTS =
  "ตอบคำถามของผู้ใช้จากผลลัพธ์ของเครื่องมือด้านบนเป็นภาษาธรรมชาติ อย่าแสดง JSON ดิบ";
const ANSWER_WITHOUT_TOOLS =
  "ตอบคำถามของผู้ใช้โดยตรงเท่าที่ข้อมูลที่มีอนุญาต อย่าเรียกเครื่องมือ และตอบเป็นภาษาเดียวกับผู้ใช้";

function callSignature(call: ToolCall) {
  return `${call.name}:${JSON.stringify(call.arguments)}`;
}

function assistantToolCallMessage(
  content: string,
  calls: ToolCall[],
): AgentMessage {
  return {
    role: "assistant",
    content,
    tool_calls: calls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: {
        name: call.name,
        arguments: JSON.stringify(call.arguments),
      },
    })),
  };
}

/**
 * Drives one chat turn: the model may call tools, read their results, and call
 * again, until it answers or the single step budget runs out.
 *
 * The budget is deliberately one number. An earlier design in a sibling project
 * carried a configured round limit and a second hardcoded depth limit, and the
 * lower one silently won — so the configured value never took effect.
 */
export async function runAgentLoop(input: {
  context: AgentRunContext;
  catalog: Map<string, AgentToolDefinition>;
  messages: AgentMessage[];
  maxSteps: number;
  /**
   * Total tool calls allowed this turn. `maxSteps` bounds the rounds, but one
   * round can request many calls at once, so the work is bounded separately.
   */
  maxToolCalls?: number;
  /** `performance.now()` value after which no further tool step may start. */
  deadline: number;
  callProvider: AgentProviderCall;
  onToken: (token: string) => void | Promise<void>;
  onStepEvent?: (event: AgentStepEvent) => void | Promise<void>;
  onArtifact?: (artifact: GeneratedChatArtifact) => void | Promise<void>;
}): Promise<AgentLoopResult> {
  const messages = [...input.messages];
  const tools = toolCatalogPayload(input.catalog);
  const evidence: GroundingEvidence[] = [];
  const citations: AgentToolCitation[] = [];
  const proposals: NtopActionDraft[] = [];
  const artifacts: GeneratedChatArtifact[] = [];
  const traces: ToolTrace[] = [];
  const attempted = new Set<string>();
  const maxToolCalls = input.maxToolCalls ?? input.maxSteps * 3;
  let executedCalls = 0;

  let content = "";
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  let finishReason: string | undefined;
  let errorCode: string | undefined;
  let stepsUsed = 0;
  let reasoningChars = 0;
  const reasoningByStep = new Map<number, ReasoningRound>();

  // Accumulated as well as forwarded: the deltas are the only place the chain
  // of thought exists, so a turn that is not kept here shows no thinking once
  // the page is reloaded.
  const recordReasoning = (step: number, delta: string) => {
    const round = reasoningByStep.get(step) ?? {
      step,
      text: "",
      truncated: false,
    };
    const room = MAX_STORED_REASONING_CHARS - round.text.length;
    reasoningByStep.set(step, {
      step,
      text: room > 0 ? round.text + delta.slice(0, room) : round.text,
      truncated: round.truncated || delta.length > room,
    });
  };

  const addUsage = (answer: ChatAnswer) => {
    if (answer.inputTokens !== undefined)
      inputTokens = (inputTokens ?? 0) + answer.inputTokens;
    if (answer.outputTokens !== undefined)
      outputTokens = (outputTokens ?? 0) + answer.outputTokens;
    if (answer.finishReason) finishReason = answer.finishReason;
    if (answer.reasoningChars) reasoningChars += answer.reasoningChars;
  };

  const emit = async (token: string) => {
    content += token;
    await input.onToken(token);
  };

  for (let step = 0; ; step++) {
    const outOfBudget =
      step >= input.maxSteps ||
      !tools.length ||
      performance.now() >= input.deadline;
    let answer: ChatAnswer | null = null;
    try {
      answer = await input.callProvider({
        messages,
        // The final pass runs without tools so the model must produce prose
        // rather than requesting a step there is no budget left to run.
        tools: outOfBudget ? undefined : tools,
        onToken: emit,
        onReasoning: (delta) => {
          recordReasoning(step, delta);
          return input.onStepEvent?.({ kind: "reasoning", step, delta });
        },
      });
    } catch (error) {
      if (!(error instanceof EmptyChatAnswerError)) throw error;
    }
    if (answer) addUsage(answer);

    const toolCalls = outOfBudget ? [] : (answer?.toolCalls ?? []);
    if (!toolCalls.length) {
      if (answer?.content || content.trim()) break;
      // Reasoning models sometimes return nothing at all. Which recovery works
      // depends on whether any tool has run yet.
      const recovery = await recoverEmptyAnswer({
        messages,
        step,
        callProvider: input.callProvider,
        onToken: emit,
      });
      if (recovery) {
        addUsage(recovery.answer);
        errorCode = recovery.errorCode;
        finishReason = recovery.errorCode;
      }
      break;
    }

    messages.push(assistantToolCallMessage(answer?.content ?? "", toolCalls));
    for (const [callIndex, call] of toolCalls.entries()) {
      const definition = input.catalog.get(call.name);
      const visibleToolCallId = definition?.traceRedacted
        ? `redacted-${step}-${callIndex}`
        : call.id;
      await input.onStepEvent?.({
        kind: "tool_start",
        step,
        toolCallId: visibleToolCallId,
        toolName: call.name,
        arguments: definition?.traceRedacted ? {} : call.arguments,
      });
      const repeated = attempted.has(callSignature(call));
      const exhausted = executedCalls >= maxToolCalls;
      const executed = exhausted
        ? budgetRefusal(call, step)
        : repeated
          ? repeatedCallRefusal(call, step)
          : await executeToolCall({
              context: input.context,
              catalog: input.catalog,
              call,
              stepIndex: step,
              evidenceOffset: evidence.length,
            });
      if (!exhausted && !repeated) executedCalls += 1;
      attempted.add(callSignature(call));
      traces.push({
        ...executed.trace,
        toolCallId: visibleToolCallId,
      });
      evidence.push(...executed.evidence);
      if (executed.result.citation) citations.push(executed.result.citation);
      if (executed.result.proposal) proposals.push(executed.result.proposal);
      for (const artifact of executed.result.artifacts ?? []) {
        artifacts.push(artifact);
        await input.onArtifact?.(artifact);
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        name: call.name,
        content: executed.message,
      });
      input.context.displayGroundingText = appendDisplayGrounding(
        input.context.displayGroundingText,
        executed.message,
      );
      await input.onStepEvent?.({
        kind: "tool_end",
        step,
        toolCallId: visibleToolCallId,
        toolName: call.name,
        isError: executed.result.isError,
        errorCode: executed.result.errorCode,
        durationMs: executed.trace.durationMs,
        summary: executed.result.content.slice(0, 500),
      });
    }
    stepsUsed = step + 1;
    // A visible pre-tool explanation and the continuation must not run together.
    if (content.trim()) await emit("\n\n");
  }

  return {
    content: content.trim(),
    evidence,
    citations,
    proposals,
    artifacts,
    traces,
    stepsUsed,
    inputTokens,
    outputTokens,
    reasoningChars: reasoningChars || undefined,
    reasoning: [...reasoningByStep.values()]
      .filter((round) => round.text.trim().length > 0)
      .sort((left, right) => left.step - right.step),
    finishReason,
    errorCode,
  };
}

/** The turn has spent its tool budget; the model is told to answer from what it has. */
function budgetRefusal(call: ToolCall, step: number): ExecutedTool {
  const message = `ใช้เครื่องมือครบจำนวนที่อนุญาตในเทิร์นนี้แล้ว ให้ตอบจากหลักฐานที่มีอยู่ หรือบอกผู้ใช้ว่ายังขาดข้อมูลส่วนใด`;
  return {
    message,
    result: {
      content: message,
      evidence: [],
      isError: true,
      errorCode: "TOOL_BUDGET_EXHAUSTED",
    },
    evidence: [],
    trace: {
      stepIndex: step,
      toolCallId: call.id,
      toolName: call.name,
      toolType: "BUDGET",
      status: "FAILED" as const,
      maskedInput: {},
      maskedOutput: { error: message },
      durationMs: 0,
      errorCode: "TOOL_BUDGET_EXHAUSTED",
    },
  };
}

/**
 * Repeating a call with identical arguments cannot produce a different result,
 * so it is refused with an explanation instead of spending the budget again.
 */
function repeatedCallRefusal(call: ToolCall, step: number): ExecutedTool {
  const message = `เรียก ${call.name} ด้วยพารามิเตอร์เดิมไปแล้วในเทิร์นนี้ ผลลัพธ์จะเหมือนเดิม ให้เปลี่ยนพารามิเตอร์ ใช้เครื่องมืออื่น หรือตอบจากหลักฐานที่มีอยู่`;
  return {
    message,
    result: {
      content: message,
      evidence: [],
      isError: true,
      errorCode: "TOOL_CALL_REPEATED",
    },
    evidence: [],
    trace: {
      stepIndex: step,
      toolCallId: call.id,
      toolName: call.name,
      toolType: "REPEATED",
      status: "FAILED" as const,
      maskedInput: {},
      maskedOutput: { error: message },
      durationMs: 0,
      errorCode: "TOOL_CALL_REPEATED",
    },
  };
}

async function recoverEmptyAnswer(input: {
  messages: AgentMessage[];
  step: number;
  callProvider: AgentProviderCall;
  onToken: (token: string) => void | Promise<void>;
}) {
  const afterTools = input.step > 0;
  const errorCode = afterTools
    ? "SUMMARIZED_TOOL_RESULTS"
    : "RETRY_WITHOUT_TOOLS";
  try {
    const answer = await input.callProvider({
      messages: [
        ...input.messages,
        {
          role: "user",
          content: afterTools ? SUMMARIZE_TOOL_RESULTS : ANSWER_WITHOUT_TOOLS,
        },
      ],
      // Both recoveries drop the tools: the model already declined to use them.
      onToken: input.onToken,
    });
    return { answer, errorCode };
  } catch {
    return null;
  }
}
