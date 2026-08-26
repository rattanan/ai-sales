import { describe, expect, it, vi } from "vitest";
import { readChatCompletionResponse } from "@/server/ai/chat-completion-stream";

function sseEvent(payload: unknown) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function streamResponse(chunks: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

/** Split a complete SSE body at arbitrary offsets, the way a socket would. */
function splitAt(body: string, ...offsets: number[]) {
  const bounds = [0, ...offsets, body.length];
  return bounds
    .slice(0, -1)
    .map((start, index) => body.slice(start, bounds[index + 1]))
    .filter(Boolean);
}

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

  it("assembles a tool call whose arguments arrive in fragments", async () => {
    const body = [
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "search_documents", arguments: "" },
                },
              ],
            },
          },
        ],
      }),
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: '{"query":"นโย' } },
              ],
            },
          },
        ],
      }),
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'บาย"}' } }],
            },
          },
        ],
      }),
      sseEvent({ choices: [{ delta: {}, finish_reason: "tool_calls" }] }),
      "data: [DONE]\n\n",
    ].join("");
    // Cut mid-event and mid-JSON so buffering across reads is exercised.
    const onToken = vi.fn();

    const answer = await readChatCompletionResponse(
      streamResponse(splitAt(body, 37, 140, 260)),
      onToken,
    );

    expect(onToken).not.toHaveBeenCalled();
    expect(answer.content).toBe("");
    expect(answer.finishReason).toBe("tool_calls");
    expect(answer.toolCalls).toEqual([
      {
        id: "call_a",
        name: "search_documents",
        arguments: { query: "นโยบาย" },
      },
    ]);
  });

  it("keeps parallel tool calls separate and ordered by index", async () => {
    const body = [
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "call_b",
                  function: { name: "query_database", arguments: '{"id":"b"}' },
                },
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "search_documents", arguments: '{"q":"a"}' },
                },
              ],
            },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ].join("");

    const answer = await readChatCompletionResponse(streamResponse([body]));

    expect(answer.toolCalls?.map((call) => call.name)).toEqual([
      "search_documents",
      "query_database",
    ]);
    expect(answer.toolCalls?.[1].arguments).toEqual({ id: "b" });
  });

  it("overrides a stop finish reason that still carries tool calls", async () => {
    const body = [
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "web_search", arguments: '{"query":"x"}' },
                },
              ],
            },
            finish_reason: "stop",
          },
        ],
      }),
      "data: [DONE]\n\n",
    ].join("");

    const answer = await readChatCompletionResponse(streamResponse([body]));

    expect(answer.finishReason).toBe("tool_calls");
  });

  it("reports unparseable tool arguments instead of running the tool bare", async () => {
    const body = [
      sseEvent({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_a",
                  function: { name: "web_search", arguments: '{"query":' },
                },
              ],
            },
          },
        ],
      }),
      "data: [DONE]\n\n",
    ].join("");

    const answer = await readChatCompletionResponse(streamResponse([body]));

    expect(answer.toolCalls?.[0]).toMatchObject({
      name: "web_search",
      arguments: {},
      argumentsError: expect.stringContaining("valid JSON"),
    });
  });

  it("rejects a turn with neither prose nor tool calls", async () => {
    const body = sseEvent({ choices: [{ delta: {} }] }) + "data: [DONE]\n\n";

    await expect(
      readChatCompletionResponse(streamResponse([body])),
    ).rejects.toThrow("empty answer");
  });

  it("reads tool calls from a non-streaming completion", async () => {
    const response = Response.json({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: "call_a",
                type: "function",
                function: {
                  name: "list_data_sources",
                  arguments: "{}",
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
      usage: { prompt_tokens: 9, completion_tokens: 4 },
    });
    const onToken = vi.fn();

    const answer = await readChatCompletionResponse(response, onToken);

    expect(onToken).not.toHaveBeenCalled();
    expect(answer).toMatchObject({
      content: "",
      inputTokens: 9,
      finishReason: "tool_calls",
      toolCalls: [{ id: "call_a", name: "list_data_sources", arguments: {} }],
    });
  });
});

describe("reasoning models", () => {
  it("never forwards chain-of-thought as answer text", async () => {
    const encoder = new TextEncoder();
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "ผู้ใช้ถามเรื่องอากาศ ควรเรียก tool" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "กรุงเทพวันนี้ฝนตกครับ" } }] })}\n\n` +
      "data: [DONE]\n\n";
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const onToken = vi.fn();

    const answer = await readChatCompletionResponse(response, onToken);

    expect(onToken.mock.calls.map(([token]) => token)).toEqual([
      "กรุงเทพวันนี้ฝนตกครับ",
    ]);
    expect(answer.content).toBe("กรุงเทพวันนี้ฝนตกครับ");
    expect(answer.content).not.toContain("ควรเรียก tool");
    expect(answer.reasoningChars).toBe(34);
  });

  it("reports how much it reasoned when it answers with nothing", async () => {
    const encoder = new TextEncoder();
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "thinking hard" } }] })}\n\n` +
      "data: [DONE]\n\n";
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );

    await expect(readChatCompletionResponse(response)).rejects.toThrow(
      /reasoned for 13 characters/,
    );
  });
});

describe("reasoning streaming", () => {
  it("forwards reasoning deltas on their own channel", async () => {
    const encoder = new TextEncoder();
    const body =
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: "คิด" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { reasoning: "ต่อ" } }] })}\n\n` +
      `data: ${JSON.stringify({ choices: [{ delta: { content: "คำตอบ" } }] })}\n\n` +
      "data: [DONE]\n\n";
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(body));
          controller.close();
        },
      }),
      { headers: { "content-type": "text/event-stream" } },
    );
    const onToken = vi.fn();
    const onReasoning = vi.fn();

    const answer = await readChatCompletionResponse(
      response,
      onToken,
      onReasoning,
    );

    expect(onReasoning.mock.calls.map(([delta]) => delta)).toEqual([
      "คิด",
      "ต่อ",
    ]);
    expect(onToken.mock.calls.map(([token]) => token)).toEqual(["คำตอบ"]);
    expect(answer.content).toBe("คำตอบ");
    // Thai tone marks are separate code units: "คิด" is 3 and "ต่อ" is 3.
    expect(answer.reasoningChars).toBe(6);
  });
});
