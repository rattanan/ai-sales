import { describe, expect, it } from "vitest";
import {
  applyStepEvent,
  mergeTrace,
  messageTrace,
  traceFromTimeline,
} from "@/lib/agent-trace";
import type { AgentTraceEntry } from "@/components/chat/agent-trace";
import type { ChatStepEvent } from "@/lib/chat-stream";

function fold(events: ChatStepEvent[]) {
  return events.reduce<AgentTraceEntry[]>(
    (entries, event) => applyStepEvent(entries, event),
    [],
  );
}

describe("applyStepEvent", () => {
  it("accumulates reasoning deltas into one entry per step", () => {
    const trace = fold([
      { kind: "reasoning", step: 0, delta: "ผู้ใช้ถาม" },
      { kind: "reasoning", step: 0, delta: "เรื่องความเร็ว" },
      { kind: "reasoning", step: 0, delta: " ควรค้นเอกสาร" },
    ]);

    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      kind: "reasoning",
      step: 0,
      text: "ผู้ใช้ถามเรื่องความเร็ว ควรค้นเอกสาร",
      done: false,
    });
  });

  it("closes the thinking phase when the model starts calling a tool", () => {
    const trace = fold([
      { kind: "reasoning", step: 0, delta: "คิดอยู่" },
      {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-1",
        toolName: "search_documents",
        arguments: { query: "ความเร็ว" },
      },
    ]);

    expect(trace[0]).toMatchObject({ kind: "reasoning", done: true });
    expect(trace[1]).toMatchObject({
      kind: "tool",
      status: "RUNNING",
      toolName: "search_documents",
      arguments: { query: "ความเร็ว" },
    });
  });

  it("completes the matching call and leaves other calls alone", () => {
    const trace = fold([
      {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-a",
        toolName: "search_documents",
        arguments: { query: "a" },
      },
      {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-b",
        toolName: "query_database",
        arguments: { question: "b" },
      },
      {
        kind: "tool_end",
        step: 0,
        toolCallId: "call-b",
        toolName: "query_database",
        isError: false,
        durationMs: 42,
        summary: "พบ 3 แถว",
      },
    ]);

    expect(trace[0]).toMatchObject({ toolCallId: "call-a", status: "RUNNING" });
    expect(trace[1]).toMatchObject({
      toolCallId: "call-b",
      status: "COMPLETED",
      durationMs: 42,
      summary: "พบ 3 แถว",
    });
  });

  it("marks a failed call with its error code", () => {
    const trace = fold([
      {
        kind: "tool_start",
        step: 1,
        toolCallId: "call-x",
        toolName: "query_database",
        arguments: {},
      },
      {
        kind: "tool_end",
        step: 1,
        toolCallId: "call-x",
        toolName: "query_database",
        isError: true,
        errorCode: "DATABASE_QUERY_ERROR",
        durationMs: 8,
        summary: "ล้มเหลว",
      },
    ]);

    expect(trace[0]).toMatchObject({
      status: "FAILED",
      errorCode: "DATABASE_QUERY_ERROR",
    });
  });
});

describe("mergeTrace", () => {
  it("interleaves by step so each thought sits above the call it produced", () => {
    const live = fold([
      { kind: "reasoning", step: 0, delta: "คิดรอบแรก" },
      {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-a",
        toolName: "list_document_sources",
        arguments: {},
      },
      { kind: "reasoning", step: 1, delta: "คิดรอบสอง" },
    ]);

    const merged = mergeTrace(live, [
      {
        step: 0,
        toolName: "list_document_sources",
        type: "DOCUMENT",
        status: "COMPLETED",
        durationMs: 21,
        errorCode: null,
        arguments: {},
        summary: "พบ 1 คลัง",
      },
      {
        step: 1,
        toolName: "search_documents",
        type: "DOCUMENT",
        status: "COMPLETED",
        durationMs: 143,
        errorCode: null,
        arguments: { query: "ความเร็ว" },
        summary: "พบ 6 ส่วน",
      },
    ]);

    expect(
      merged.map((entry) =>
        entry.kind === "reasoning" ? `reasoning:${entry.step}` : entry.toolName,
      ),
    ).toEqual([
      "reasoning:0",
      "list_document_sources",
      "reasoning:1",
      "search_documents",
    ]);
    // The saved turn is authoritative for duration and result.
    expect(merged[1]).toMatchObject({ durationMs: 21, summary: "พบ 1 คลัง" });
    expect(
      merged.every((entry) => entry.kind !== "reasoning" || entry.done),
    ).toBe(true);
  });

  it("keeps a final round of thinking that produced no tool call", () => {
    // The last pass answers instead of calling anything, and that thought is
    // the one explaining the answer — it must not be dropped.
    const live = fold([
      { kind: "reasoning", step: 0, delta: "ต้องค้นก่อน" },
      {
        kind: "tool_start",
        step: 0,
        toolCallId: "call-a",
        toolName: "search_documents",
        arguments: {},
      },
      { kind: "reasoning", step: 1, delta: "ข้อมูลพอแล้ว ตอบได้" },
    ]);

    const merged = mergeTrace(live, [
      {
        step: 0,
        toolName: "search_documents",
        type: "DOCUMENT",
        status: "COMPLETED",
        durationMs: 10,
        errorCode: null,
        arguments: {},
        summary: "ok",
      },
    ]);

    expect(merged).toHaveLength(3);
    expect(merged.at(-1)).toMatchObject({
      kind: "reasoning",
      step: 1,
      text: "ข้อมูลพอแล้ว ตอบได้",
    });
  });

  it("drops reasoning that produced no text", () => {
    const merged = mergeTrace(
      [{ kind: "reasoning", step: 0, text: "   ", done: true }],
      [],
    );

    expect(merged).toEqual([]);
  });
});

describe("traceFromTimeline", () => {
  it("rebuilds tool steps for a reloaded conversation", () => {
    const trace = traceFromTimeline([
      {
        step: 0,
        toolName: "api__ntsp_sr",
        type: "API",
        status: "COMPLETED",
        durationMs: 274,
        errorCode: null,
        arguments: { query: "4569J5771" },
        summary: "ok",
      },
    ]);

    expect(trace).toEqual([
      {
        kind: "tool",
        step: 0,
        toolCallId: "stored-0",
        toolName: "api__ntsp_sr",
        type: "API",
        status: "COMPLETED",
        durationMs: 274,
        errorCode: null,
        arguments: { query: "4569J5771" },
        summary: "ok",
      },
    ]);
  });
});

describe("messageTrace", () => {
  const live: AgentTraceEntry[] = [
    { kind: "reasoning", step: 0, text: "คิดสด", done: false },
  ];

  it("reads the live stream for the turn still streaming", () => {
    expect(messageTrace({ id: "streaming-1", toolTimeline: [] }, live)).toEqual(
      live,
    );
  });

  it("prefers the session trace, which is the only place reasoning survives", () => {
    const saved: AgentTraceEntry[] = [
      { kind: "reasoning", step: 0, text: "คิดไว้", done: true },
      {
        kind: "tool",
        step: 0,
        toolName: "search_documents",
        type: "DOCUMENT",
        status: "COMPLETED",
      },
    ];

    expect(messageTrace({ id: "msg-1", trace: saved }, live)).toEqual(saved);
  });

  it("falls back to the persisted timeline after a reload", () => {
    const trace = messageTrace(
      {
        id: "msg-1",
        toolTimeline: [
          {
            step: 0,
            toolName: "query_database",
            type: "DATABASE",
            status: "COMPLETED",
            durationMs: 12,
            errorCode: null,
            arguments: null,
            summary: null,
          },
        ],
      },
      live,
    );

    expect(trace).toHaveLength(1);
    expect(trace[0]).toMatchObject({
      kind: "tool",
      toolName: "query_database",
    });
    // Reasoning is not persisted, so a reloaded turn shows tools only.
    expect(trace.some((entry) => entry.kind === "reasoning")).toBe(false);
  });

  it("shows nothing for a turn that used no tools", () => {
    expect(messageTrace({ id: "msg-1" }, live)).toEqual([]);
  });
});

describe("unsaved turns", () => {
  it("keeps the trace for a delivered-but-unsaved answer", () => {
    // A storage failure returns an `unsaved-` id. The answer already reached
    // the reader, so its trace must survive rather than being treated as an
    // empty turn.
    const live: AgentTraceEntry[] = [
      { kind: "reasoning", step: 0, text: "คิดแล้ว", done: true },
    ];
    const merged = mergeTrace(live, [
      {
        step: 0,
        toolName: "api__ntsp_sr",
        type: "API",
        status: "COMPLETED",
        durationMs: 151,
        errorCode: null,
        arguments: { query: "4569J5771" },
        summary: "ok",
      },
    ]);

    const shown = messageTrace(
      { id: `unsaved-${"a".repeat(8)}`, trace: merged },
      [],
    );

    expect(shown).toHaveLength(2);
    expect(shown[0]).toMatchObject({ kind: "reasoning", text: "คิดแล้ว" });
    expect(shown[1]).toMatchObject({ toolName: "api__ntsp_sr" });
  });
});

describe("stored reasoning", () => {
  const timeline = [
    {
      step: 0,
      toolName: "list_document_sources",
      type: "DOCUMENT",
      status: "COMPLETED",
      durationMs: 20,
      errorCode: null,
      arguments: {},
      summary: "3 คลัง",
    },
    {
      step: 1,
      toolName: "search_documents",
      type: "DOCUMENT",
      status: "COMPLETED",
      durationMs: 38,
      errorCode: null,
      arguments: { query: "นโยบาย" },
      summary: "พบ 2 ชิ้น",
    },
  ];

  it("rebuilds the interleaved trace after a reload", () => {
    const trace = traceFromTimeline(timeline, [
      { step: 0, text: "ดูก่อนว่ามีคลังอะไร" },
      { step: 1, text: "ค้นด้วยคำที่แคบลง" },
      { step: 2, text: "หลักฐานพอแล้ว ตอบได้" },
    ]);

    // Think, act, think, act, think — the same order the asker watched, not
    // the tool steps alone as before the rounds were persisted.
    expect(
      trace.map((entry) =>
        entry.kind === "reasoning" ? `think:${entry.step}` : entry.toolName,
      ),
    ).toEqual([
      "think:0",
      "list_document_sources",
      "think:1",
      "search_documents",
      "think:2",
    ]);
    expect(
      trace.every((entry) => entry.kind !== "reasoning" || entry.done),
    ).toBe(true);
  });

  it("carries the truncation flag through to the view", () => {
    const [round] = traceFromTimeline(
      [],
      [{ step: 0, text: "คิดยาวมาก", truncated: true }],
    );

    expect(round).toMatchObject({ kind: "reasoning", truncated: true });
  });

  it("drops a stored round that holds no text", () => {
    expect(traceFromTimeline([], [{ step: 0, text: "   " }])).toEqual([]);
  });

  it("reads the stored rounds for a message with no session trace", () => {
    const shown = messageTrace(
      {
        id: "message-1",
        toolTimeline: timeline,
        reasoningTimeline: [{ step: 0, text: "เริ่มจากดูคลัง" }],
      },
      [],
    );

    expect(shown[0]).toMatchObject({
      kind: "reasoning",
      text: "เริ่มจากดูคลัง",
    });
    expect(shown).toHaveLength(3);
  });

  it("prefers the session trace, which is not capped", () => {
    const live = [
      {
        kind: "reasoning" as const,
        step: 0,
        text: "ข".repeat(9_000),
        done: true,
      },
    ];

    const shown = messageTrace(
      {
        id: "message-1",
        trace: live,
        reasoningTimeline: [
          { step: 0, text: "ข".repeat(4_000), truncated: true },
        ],
      },
      [],
    );

    expect(shown[0]).toMatchObject({ text: "ข".repeat(9_000) });
  });
});
