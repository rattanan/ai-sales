import { describe, expect, it, vi } from "vitest";
import { readChatStream } from "@/lib/chat-stream";

describe("readChatStream", () => {
  it("reassembles fragmented SSE tokens and returns the final result", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'event: status\ndata: {"phase":"retrieving"}\n\nevent: token\nda',
      'ta: "สวัสดี"\n\nevent: result\ndata: {"id":"message-1"}\n\n',
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream; charset=utf-8" } },
    );
    const onToken = vi.fn();
    const onStatus = vi.fn();

    const result = await readChatStream<{ id: string }>(response, {
      onToken,
      onStatus,
    });

    expect(onStatus).toHaveBeenCalledWith("retrieving");
    expect(onToken).toHaveBeenCalledWith("สวัสดี");
    expect(result).toEqual({ id: "message-1" });
  });

  it("surfaces an SSE error event", async () => {
    const response = new Response(
      'event: error\ndata: {"error":"AI_PROVIDER_ERROR","message":"Provider unavailable"}\n\n',
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(
      readChatStream(response, { onToken: vi.fn() }),
    ).rejects.toThrow("Provider unavailable");
  });
});
