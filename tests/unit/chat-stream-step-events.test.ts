import { describe, expect, it, vi } from "vitest";
import { readChatStream, type ChatStepEvent } from "@/lib/chat-stream";

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function streamOf(body: string) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(body));
        controller.close();
      },
    }),
    { status: 200, headers: { "content-type": "text/event-stream" } },
  );
}

describe("readChatStream step events", () => {
  it("delivers reasoning and tool events in order", async () => {
    const events: ChatStepEvent[] = [];
    const onToken = vi.fn();

    const result = await readChatStream<{ ok: number }>(
      streamOf(
        [
          sse("step", { kind: "reasoning", step: 0, delta: "คิด" }),
          sse("step", { kind: "reasoning", step: 0, delta: "ต่อ" }),
          sse("step", {
            kind: "tool_start",
            step: 0,
            toolCallId: "c1",
            toolName: "search_documents",
            arguments: { query: "q" },
          }),
          sse("token", "ตอบ"),
          sse("result", { ok: 1 }),
        ].join(""),
      ),
      { onToken, onStepEvent: (event) => events.push(event) },
    );

    expect(events.map((event) => event.kind)).toEqual([
      "reasoning",
      "reasoning",
      "tool_start",
    ]);
    expect(onToken).toHaveBeenCalledWith("ตอบ");
    expect(result).toEqual({ ok: 1 });
  });

  it("survives a reasoning delta that contains newlines", async () => {
    const events: ChatStepEvent[] = [];

    await readChatStream<{ ok: number }>(
      streamOf(
        sse("step", {
          kind: "reasoning",
          step: 0,
          delta: "บรรทัดแรก\nบรรทัดสอง\n\nเว้นวรรค",
        }) + sse("result", { ok: 1 }),
      ),
      { onToken: vi.fn(), onStepEvent: (event) => events.push(event) },
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "reasoning",
      delta: "บรรทัดแรก\nบรรทัดสอง\n\nเว้นวรรค",
    });
  });

  it("handles an event split across socket reads", async () => {
    const encoder = new TextEncoder();
    const body =
      sse("step", { kind: "reasoning", step: 0, delta: "ยาวมาก" }) +
      sse("result", { ok: 1 });
    const cut = 20;
    const events: ChatStepEvent[] = [];

    await readChatStream<{ ok: number }>(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(encoder.encode(body.slice(0, cut)));
            controller.enqueue(encoder.encode(body.slice(cut)));
            controller.close();
          },
        }),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      ),
      { onToken: vi.fn(), onStepEvent: (event) => events.push(event) },
    );

    expect(events).toHaveLength(1);
  });
});
