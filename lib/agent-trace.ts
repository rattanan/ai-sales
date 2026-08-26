import type { AgentTraceEntry } from "@/components/chat/agent-trace";
import type { ChatStepEvent } from "@/lib/chat-stream";

export type ReasoningRow = {
  step: number;
  text: string;
  truncated?: boolean;
};

type TimelineStep = {
  step: number;
  toolName: string;
  type: string;
  status: string;
  durationMs?: number;
  errorCode?: string | null;
  arguments?: Record<string, unknown> | null;
  summary?: string | null;
};

/**
 * Folds the live step stream into the trace the UI renders.
 *
 * Reasoning arrives as many small deltas, so it accumulates into a single
 * entry per step rather than one entry per chunk; it is marked done as soon as
 * the model moves on to a tool call, which is what ends the thinking phase.
 */
export function applyStepEvent(
  entries: AgentTraceEntry[],
  event: ChatStepEvent,
): AgentTraceEntry[] {
  if (event.kind === "reasoning") {
    const index = entries.findIndex(
      (entry) => entry.kind === "reasoning" && entry.step === event.step,
    );
    if (index < 0)
      return [
        ...entries,
        {
          kind: "reasoning",
          step: event.step,
          text: event.delta,
          done: false,
        },
      ];
    return entries.map((entry, position) =>
      position === index && entry.kind === "reasoning"
        ? { ...entry, text: entry.text + event.delta }
        : entry,
    );
  }

  if (event.kind === "tool_start")
    return [
      ...entries.map((entry) =>
        entry.kind === "reasoning" && !entry.done
          ? { ...entry, done: true }
          : entry,
      ),
      {
        kind: "tool",
        step: event.step,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        // The group is unknown until the result lands; the icon falls back.
        type: "",
        status: "RUNNING",
        arguments: event.arguments ?? null,
      },
    ];

  return entries.map((entry) =>
    entry.kind === "tool" && entry.toolCallId === event.toolCallId
      ? {
          ...entry,
          status: event.isError ? "FAILED" : "COMPLETED",
          errorCode: event.errorCode ?? null,
          durationMs: event.durationMs,
          summary: event.summary || null,
        }
      : entry,
  );
}

/**
 * Interleaves by step, because that is the order it happened in: the model
 * thinks, acts on what it learned, thinks again. Grouping all the thinking above
 * all the tools loses the causal link between a thought and the call it led to.
 */
function interleave(
  reasoning: Array<Extract<AgentTraceEntry, { kind: "reasoning" }>>,
  tools: AgentTraceEntry[],
): AgentTraceEntry[] {
  const steps = [
    ...new Set([
      ...reasoning.map((entry) => entry.step),
      ...tools.map((entry) => entry.step),
    ]),
  ].sort((left, right) => left - right);
  return steps.flatMap((step) => [
    // Thinking precedes the calls it produced within the same step.
    ...reasoning.filter((entry) => entry.step === step),
    ...tools.filter((entry) => entry.step === step),
  ]);
}

function storedTools(timeline: TimelineStep[]): AgentTraceEntry[] {
  return timeline.map((step, index) => ({
    kind: "tool",
    step: step.step,
    toolCallId: `stored-${index}`,
    toolName: step.toolName,
    type: step.type,
    status: step.status,
    durationMs: step.durationMs,
    errorCode: step.errorCode ?? null,
    arguments: step.arguments ?? null,
    summary: step.summary ?? null,
  }));
}

/** Rebuilds the trace for a stored turn, thinking included. */
export function traceFromTimeline(
  timeline: TimelineStep[],
  reasoning: ReasoningRow[] = [],
): AgentTraceEntry[] {
  return interleave(
    reasoning
      .filter((round) => round.text.trim().length > 0)
      .map((round) => ({
        kind: "reasoning" as const,
        step: round.step,
        text: round.text,
        truncated: round.truncated,
        done: true,
      })),
    storedTools(timeline),
  );
}

/**
 * Combines the reasoning this session watched arrive with what the saved turn
 * knows (tool group, duration, result summary).
 *
 * Preferred over the stored rounds for a turn that just finished: the live text
 * is the whole chain of thought, while storage keeps a capped copy.
 */
export function mergeTrace(
  live: AgentTraceEntry[],
  timeline: TimelineStep[],
): AgentTraceEntry[] {
  return interleave(
    live
      .filter(
        (entry): entry is Extract<AgentTraceEntry, { kind: "reasoning" }> =>
          entry.kind === "reasoning" && entry.text.trim().length > 0,
      )
      .map((entry) => ({ ...entry, done: true })),
    storedTools(timeline),
  );
}

/**
 * The trace to show for one message. A turn still streaming has no saved
 * timeline yet, so it reads from the live stream; everything else prefers the
 * richer session trace and falls back to what was persisted.
 */
export function messageTrace(
  message: {
    id: string;
    trace?: AgentTraceEntry[];
    toolTimeline?: TimelineStep[];
    reasoningTimeline?: ReasoningRow[];
  },
  live: AgentTraceEntry[],
): AgentTraceEntry[] {
  if (message.id.startsWith("streaming-")) return live;
  if (message.trace?.length) return message.trace;
  return traceFromTimeline(
    message.toolTimeline ?? [],
    message.reasoningTimeline ?? [],
  );
}
