export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /**
   * Set when the provider's argument JSON could not be parsed. The agent loop
   * reports this back to the model as a tool error so it can retry with valid
   * JSON, rather than running the tool with no arguments.
   */
  argumentsError?: string;
};

export type ChatAnswer = {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
  toolCalls?: ToolCall[];
  finishReason?: string;
  /**
   * Characters of chain-of-thought the provider emitted. Never shown to the
   * user or persisted as content, but a turn that reasoned at length and then
   * returned nothing is otherwise indistinguishable from a dead provider.
   */
  reasoningChars?: number;
};

type TokenEmitter = (token: string) => void | Promise<void>;

/**
 * A turn that produced neither prose nor a tool call. Reasoning models do this
 * often enough that the agent loop retries rather than failing the turn, so it
 * needs to tell this apart from a transport or provider fault.
 */
export class EmptyChatAnswerError extends Error {
  constructor(readonly reasoningChars = 0) {
    super(
      reasoningChars
        ? `Chat provider reasoned for ${reasoningChars} characters but returned no answer`
        : "Chat provider returned an empty answer",
    );
    this.name = "EmptyChatAnswerError";
  }
}

type ToolCallDelta = {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
};

type StreamedToolCall = { id: string; name: string; arguments: string };

function toolCall(
  id: string,
  name: string,
  serializedArguments: string,
): ToolCall {
  const callId = id || crypto.randomUUID();
  const trimmed = serializedArguments.trim();
  if (!trimmed) return { id: callId, name, arguments: {} };
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return {
      id: callId,
      name,
      arguments: {},
      argumentsError: "Tool arguments were not valid JSON.",
    };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return {
      id: callId,
      name,
      arguments: {},
      argumentsError: "Tool arguments must be a JSON object.",
    };
  return { id: callId, name, arguments: parsed as Record<string, unknown> };
}

/**
 * Providers stream one tool call in fragments keyed by `index`: the id and name
 * arrive once, then `function.arguments` accumulates a JSON slice at a time.
 * Nothing is parseable until the stream ends, so fragments are held until then.
 */
function collectToolCallDeltas(
  deltas: ToolCallDelta[],
  inProgress: Map<number, StreamedToolCall>,
) {
  for (const delta of deltas) {
    if (typeof delta?.index !== "number") continue;
    const current = inProgress.get(delta.index) ?? {
      id: "",
      name: "",
      arguments: "",
    };
    if (delta.id) current.id = delta.id;
    if (delta.function?.name) current.name = delta.function.name;
    if (delta.function?.arguments)
      current.arguments += delta.function.arguments;
    inProgress.set(delta.index, current);
  }
}

function finalizeToolCalls(inProgress: Map<number, StreamedToolCall>) {
  return [...inProgress.entries()]
    .sort(([left], [right]) => left - right)
    .filter(([, call]) => call.name)
    .map(([, call]) => toolCall(call.id, call.name, call.arguments));
}

/**
 * Some providers report `stop` on a turn that also carries tool calls. Trusting
 * that would end the agent loop before the requested tools ever run.
 */
function resolvedFinishReason(
  reported: string | undefined,
  toolCalls: ToolCall[],
) {
  if (toolCalls.length && (!reported || reported === "stop"))
    return "tool_calls";
  return reported;
}

export async function readChatCompletionResponse(
  response: Response,
  onToken?: TokenEmitter,
  /**
   * Receives the model's chain-of-thought as it streams. Kept separate from
   * `onToken` because it is not an answer: the caller decides whether to show
   * it, and it is never persisted as message content.
   */
  onReasoning?: TokenEmitter,
): Promise<ChatAnswer> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    if (!response.body)
      throw new Error("Chat provider returned an empty answer stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let finishReason: string | undefined;
    let reasoningChars = 0;
    const toolCallsInProgress = new Map<number, StreamedToolCall>();

    const consumeEvent = async (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const payload = JSON.parse(data) as {
        choices?: Array<{
          delta?: {
            content?: string;
            reasoning?: string;
            reasoning_content?: string;
            tool_calls?: ToolCallDelta[];
          };
          finish_reason?: string | null;
        }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const delta = payload.choices?.[0]?.delta;
      const token = delta?.content;
      if (token) {
        content += token;
        await onToken?.(token);
      }
      // Reasoning models stream their scratchpad separately. It is never mixed
      // into the answer, and it reaches the caller only through onReasoning.
      const reasoning = delta?.reasoning ?? delta?.reasoning_content;
      if (reasoning) {
        reasoningChars += reasoning.length;
        await onReasoning?.(reasoning);
      }
      const toolCallDeltas = delta?.tool_calls;
      if (toolCallDeltas?.length)
        collectToolCallDeltas(toolCallDeltas, toolCallsInProgress);
      const reportedFinishReason = payload.choices?.[0]?.finish_reason;
      if (reportedFinishReason) finishReason = reportedFinishReason;
      // The usage chunk arrives with an empty `choices` array, so it is read
      // independently of anything that dereferences choices[0].
      if (payload.usage) {
        inputTokens = payload.usage.prompt_tokens;
        outputTokens = payload.usage.completion_tokens;
      }
    };

    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder
          .decode(next.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          await consumeEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) await consumeEvent(buffer.trim());
    } finally {
      reader.releaseLock();
    }
    const toolCalls = finalizeToolCalls(toolCallsInProgress);
    const answer = content.trim();
    // A turn that only requests tools carries no prose, and that is a complete
    // answer for the agent loop. Only a turn with neither is empty.
    if (!answer && !toolCalls.length)
      throw new EmptyChatAnswerError(reasoningChars);
    return {
      content: answer,
      inputTokens,
      outputTokens,
      toolCalls: toolCalls.length ? toolCalls : undefined,
      finishReason: resolvedFinishReason(finishReason, toolCalls),
      reasoningChars: reasoningChars || undefined,
    };
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
        tool_calls?: Array<{
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string | null;
    }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const choice = payload.choices?.[0];
  const content = choice?.message?.content?.trim() ?? "";
  const toolCalls = (choice?.message?.tool_calls ?? [])
    .filter((call) => call.function?.name)
    .map((call) =>
      toolCall(
        call.id ?? "",
        call.function!.name!,
        call.function?.arguments ?? "",
      ),
    );
  if (!content && !toolCalls.length) throw new EmptyChatAnswerError();
  if (content) await onToken?.(content);
  return {
    content,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    finishReason: resolvedFinishReason(
      choice?.finish_reason ?? undefined,
      toolCalls,
    ),
  };
}
