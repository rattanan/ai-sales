import { z } from "zod";
import { sanitizeRetrievedContent } from "@/server/services/retrieval-service";
import { maskFreeText } from "@/server/services/sensitive-data";
import { logger } from "@/server/services/logger";
import type { ToolCall } from "@/server/ai/chat-completion-stream";
import type {
  AgentRunContext,
  AgentToolDefinition,
  AgentToolResult,
  GroundingEvidence,
} from "@/server/ai/agent/types";

/** Bounds one tool message so a long result cannot crowd out the conversation. */
const MAX_TOOL_MESSAGE_CHARS = 6_000;
/** Bounds what a trace row stores; a multi-step turn otherwise grows without limit. */
const MAX_STORED_TOOL_RESULT = 4_000;

export type ToolTrace = {
  stepIndex: number;
  toolCallId: string;
  toolName: string;
  toolType: string;
  toolId?: string;
  status: "COMPLETED" | "FAILED";
  maskedInput: Record<string, unknown>;
  maskedOutput: Record<string, unknown>;
  durationMs: number;
  errorCode?: string;
};

export type ExecutedTool = {
  /** Text placed in the `tool` message the model reads next. */
  message: string;
  result: AgentToolResult;
  /** Evidence numbered from `evidenceOffset`, already sanitized and masked. */
  evidence: GroundingEvidence[];
  trace: ToolTrace;
};

function truncate(value: string, limit: number) {
  return value.length > limit ? `${value.slice(0, limit)}\n…[ตัดทอน]` : value;
}

function zodMessage(error: z.ZodError) {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "arguments"}: ${issue.message}`)
    .join("; ");
}

function failedTool(
  call: ToolCall,
  stepIndex: number,
  toolType: string,
  message: string,
  errorCode: string,
  durationMs = 0,
): ExecutedTool {
  return {
    message,
    result: { content: message, evidence: [], isError: true, errorCode },
    evidence: [],
    trace: {
      stepIndex,
      toolCallId: call.id,
      toolName: call.name,
      toolType,
      status: "FAILED",
      maskedInput: {},
      maskedOutput: { error: message },
      durationMs,
      errorCode,
    },
  };
}

/**
 * Runs one tool call. Authorization is re-checked here rather than only when
 * the catalog was built: the model choosing a tool is not evidence that this
 * user may run it, and the catalog can be several steps old by now.
 */
export async function executeToolCall(input: {
  context: AgentRunContext;
  catalog: Map<string, AgentToolDefinition>;
  call: ToolCall;
  stepIndex: number;
  /** Running count of evidence already cited this turn, for stable markers. */
  evidenceOffset: number;
}): Promise<ExecutedTool> {
  const { context, catalog, call, stepIndex } = input;
  const definition = catalog.get(call.name);
  if (!definition)
    return failedTool(
      call,
      stepIndex,
      "UNKNOWN",
      `ไม่มีเครื่องมือชื่อ "${call.name}" ให้ใช้ในเทิร์นนี้ ให้เลือกจากรายการเครื่องมือที่มีเท่านั้น`,
      "TOOL_NOT_AVAILABLE",
    );
  if (call.argumentsError)
    return failedTool(
      call,
      stepIndex,
      definition.group,
      `พารามิเตอร์ของ ${call.name} ไม่ถูกต้อง: ${call.argumentsError} ให้เรียกใหม่ด้วย JSON ที่ถูกต้อง`,
      "TOOL_ARGUMENTS_INVALID",
    );

  const parsed = definition.parameters.safeParse(call.arguments);
  if (!parsed.success)
    return failedTool(
      call,
      stepIndex,
      definition.group,
      `พารามิเตอร์ของ ${call.name} ไม่ผ่านการตรวจสอบ: ${zodMessage(parsed.error)} ให้แก้แล้วเรียกใหม่`,
      "TOOL_ARGUMENTS_INVALID",
    );

  const startedAt = performance.now();
  let authorized = false;
  try {
    authorized = await definition.authorize(context, parsed.data);
  } catch (error) {
    logger.error("Agent tool authorization failed", {
      toolName: call.name,
      errorType: error instanceof Error ? error.name : typeof error,
    });
  }
  if (!authorized)
    return failedTool(
      call,
      stepIndex,
      definition.group,
      `ผู้ใช้ไม่มีสิทธิ์ใช้ ${call.name} หรือทรัพยากรที่ระบุ ให้แจ้งผู้ใช้ว่าไม่มีสิทธิ์เข้าถึง อย่าเดาคำตอบแทน`,
      "TOOL_FORBIDDEN",
      Math.round(performance.now() - startedAt),
    );

  let result: AgentToolResult;
  try {
    result = await definition.execute(context, parsed.data);
  } catch (error) {
    logger.error("Agent tool execution failed", {
      toolName: call.name,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return failedTool(
      call,
      stepIndex,
      definition.group,
      `เรียก ${call.name} ไม่สำเร็จในขณะนี้ ให้ลองเครื่องมืออื่น หรือแจ้งผู้ใช้ว่าดึงข้อมูลส่วนนี้ไม่ได้`,
      "TOOL_EXECUTION_ERROR",
      Math.round(performance.now() - startedAt),
    );
  }
  const durationMs = Math.round(performance.now() - startedAt);

  // Tool output is untrusted data on its way back into the prompt. Embedded
  // instructions are stripped from every tool. Masking is skipped in two cases:
  // where the tool's own service already did it per field, and where the
  // organization has turned on Allow sensitive AI access — the same switch the
  // legacy chat path already honours before sending unmasked page images, and
  // the only way a salesperson can read their own customer's phone number back
  // out of the CRM instead of `[MASKED_PHONE]`.
  const unmasked =
    definition.selfMasked || context.privacyPolicy.allowSensitiveAiAccess;
  const clean = (value: string) => {
    const sanitized = sanitizeRetrievedContent(value);
    return unmasked
      ? sanitized
      : maskFreeText(sanitized, context.privacyPolicy);
  };
  const evidence = result.evidence.map((item) => ({
    ...item,
    content: clean(item.content),
  }));
  const summary = clean(result.content);
  const citedEvidence = evidence
    .map(
      (item, index) =>
        `[${input.evidenceOffset + index + 1}] ${item.documentName}\n${item.content}`,
    )
    .join("\n\n");
  const message = truncate(
    citedEvidence ? `${summary}\n\nหลักฐาน:\n${citedEvidence}` : summary,
    MAX_TOOL_MESSAGE_CHARS,
  );

  return {
    message,
    result: { ...result, content: summary, evidence },
    evidence,
    trace: {
      stepIndex,
      toolCallId: call.id,
      toolName: call.name,
      toolType: definition.group,
      toolId: result.citation?.id,
      status: result.isError ? "FAILED" : "COMPLETED",
      maskedInput: maskedArguments(parsed.data, context),
      maskedOutput: {
        summary: truncate(summary, MAX_STORED_TOOL_RESULT),
        evidenceCount: evidence.length,
        truncated: summary.length > MAX_STORED_TOOL_RESULT || undefined,
      },
      durationMs,
      errorCode: result.errorCode,
    },
  };
}

/**
 * Arguments are model-authored and can echo personal data out of a previous
 * tool result, so they are masked before being persisted to the audit trail.
 */
function maskedArguments(args: unknown, context: AgentRunContext) {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  return Object.fromEntries(
    Object.entries(args as Record<string, unknown>).map(([key, value]) => [
      key,
      typeof value === "string"
        ? maskFreeText(value, context.privacyPolicy)
        : value,
    ]),
  );
}
