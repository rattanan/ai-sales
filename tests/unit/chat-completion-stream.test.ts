import { describe, expect, it, vi } from "vitest";
import { readChatCompletionResponse } from "@/server/ai/chat-completion-stream";

describe("readChatCompletionResponse", () => {
  it("forwards provider deltas as they arrive", async () => {
    const encoder = new TextEncoder();
    const chunks = [
      'data: {"choices":[{"delta":{"content":"คำ"}}]}\n\nda',
      'ta: {"choices":[{"delta":{"content":"ตอบ"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":2}}\n\n',
      "data: [DONE]\n\n",
    ];
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const onToken = vi.fn();

    const answer = await readChatCompletionResponse(response, onToken);

    expect(onToken.mock.calls.map(([token]) => token)).toEqual(["คำ", "ตอบ"]);
    expect(answer).toEqual({
      content: "คำตอบ",
      inputTokens: 12,
      outputTokens: 2,
    });
  });

  it("falls back to a single token when a provider ignores streaming", async () => {
    const response = Response.json({
      choices: [{ message: { content: "Complete answer" } }],
      usage: { prompt_tokens: 5, completion_tokens: 2 },
    });
    const onToken = vi.fn();

    const answer = await readChatCompletionResponse(response, onToken);

    expect(onToken).toHaveBeenCalledWith("Complete answer");
    expect(answer.content).toBe("Complete answer");
  });
});
