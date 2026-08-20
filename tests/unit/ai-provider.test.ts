import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OpenAICompatibleProvider } from "@/server/ai/openai-compatible";
import type { AIProviderConfiguration } from "@/server/ai/types";

const configuration: AIProviderConfiguration = {
  provider: "openai-compatible",
  baseUrl: "https://provider.example/v1/",
  apiKey: "test-provider-key",
  model: "test-model",
  timeoutMs: 2_000,
  inactivityTimeoutMs: 500,
  maxRetries: 0,
  temperature: 0.1,
  supportsJsonSchema: true,
};

const outputSchema = z.object({
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

function request() {
  return {
    requestId: "request-123",
    schemaName: "schema_analysis",
    outputSchema,
    systemPrompt: "Use only approved metadata.",
    userPrompt: "Analyze the approved tables.",
    promptVersion: "schema-analysis-v1",
  };
}

function streamingResponse(parts: string[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("OpenAI-compatible provider", () => {
  it("falls back to a non-streaming compatible response and validates it", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ summary: "Grounded", confidence: 0.9 }),
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data.summary).toBe("Grounded");
    expect(result.data.usage?.totalTokens).toBe(15);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://provider.example/v1/chat/completions");
    expect(init.headers).toMatchObject({
      authorization: "Bearer test-provider-key",
      "x-request-id": "request-123",
    });
    expect(JSON.parse(String(init.body)).response_format.type).toBe(
      "json_schema",
    );
    expect(JSON.parse(String(init.body)).stream).toBe(true);
  });

  it("extracts valid JSON from an accidental Markdown code fence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                content:
                  'Here is the result:\n```json\n{"summary":"Grounded","confidence":0.9}\n```',
              },
            },
          ],
        }),
      ),
    );

    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());

    expect(result.ok).toBe(true);
  });

  it("assembles split SSE chunks and captures final usage", async () => {
    const progress = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse([
            'data: {"choices":[{"delta":{"content":"{\\"summary\\":"}}]}\n\n',
            'data: {"choices":[{"delta":{"content":"\\"Grounded\\",\\"confidence\\":0.9}"}}]}\n\n',
            'data: {"choices":[],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n',
            "data: [DONE]\n\n",
          ]),
        ),
    );

    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput({ ...request(), onProgress: progress });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data).toEqual({ summary: "Grounded", confidence: 0.9 });
    expect(result.data.usage?.totalTokens).toBe(15);
    expect(progress).toHaveBeenCalled();
  });

  it("accepts a complete SSE payload when the provider omits its DONE event", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse([
            'data: {"choices":[{"delta":{"content":"{\\"summary\\":\\"Grounded\\",\\"confidence\\":0.9}"}}]}\n\n',
          ]),
        ),
    );

    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());

    expect(result.ok).toBe(true);
  });

  it("rejects malformed SSE events", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          streamingResponse(["data: not-json\n\n", "data: [DONE]\n\n"]),
        ),
    );
    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_INVALID_RESPONSE");
  });

  it("reports a timeout before the first provider chunk", async () => {
    const fetchMock = vi.fn(
      (_: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider({
      ...configuration,
      timeoutMs: 20,
      inactivityTimeoutMs: 10,
    }).generateStructuredOutput(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_TIMEOUT");
    expect(result.error.message).toContain("did not begin responding");
  });

  it("honors a shorter timeout requested by a bounded operation", async () => {
    const fetchMock = vi.fn(
      (_: string, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput({ ...request(), timeoutMs: 20 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_TIMEOUT");
    expect(result.error.diagnostics).toMatchObject({
      timeoutKind: "absolute",
    });
  });

  it("reports an inactivity timeout after a provider stream stalls", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"choices":[{"delta":{"content":"{\\"summary\\":"}}]}\n\n',
          ),
        );
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(body, {
          headers: { "content-type": "text/event-stream" },
        }),
      ),
    );
    const result = await new OpenAICompatibleProvider({
      ...configuration,
      timeoutMs: 100,
      inactivityTimeoutMs: 10,
    }).generateStructuredOutput(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_TIMEOUT");
    expect(result.error.message).toContain("stream stalled");
  });

  it("rejects invalid structured output without extracting text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          Response.json({
            choices: [{ message: { content: "Result: {}" } }],
          }),
        ),
      ),
    );
    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_INVALID_RESPONSE");
  });

  it("retries transient provider failures within the configured bound", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Recovered",
                  confidence: 0.8,
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider({
      ...configuration,
      maxRetries: 1,
    }).generateStructuredOutput(request());
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("explains when a provider rejects a large JSON Schema", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          [
            {
              error: {
                code: 400,
                status: "INVALID_ARGUMENT",
                message: "The specified schema produces too many states.",
              },
            },
          ],
          { status: 400 },
        ),
      ),
    );
    const result = await new OpenAICompatibleProvider(
      configuration,
    ).generateStructuredOutput(request());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("AI_SUPPORTS_JSON_SCHEMA=false");
    expect(result.error.diagnostics?.providerErrorStatus).toBe(
      "INVALID_ARGUMENT",
    );
  });

  it("reports missing model configuration without a network request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider({
      ...configuration,
      model: undefined,
    }).healthCheck("health-request");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("AI_CONFIGURATION_ERROR");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("supports compatible servers limited to JSON object mode", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: JSON.stringify({ summary: "Local", confidence: 1 }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await new OpenAICompatibleProvider({
      ...configuration,
      supportsJsonSchema: false,
    }).generateStructuredOutput(request());
    expect(result.ok).toBe(true);
    const body = JSON.parse(
      String((fetchMock.mock.calls[0][1] as RequestInit).body),
    );
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain(
      "It must satisfy this JSON Schema",
    );
  });

  it("repairs invalid JSON-object output once using safe schema feedback", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: JSON.stringify({ summary: 42 }) } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Repaired",
                  confidence: 0.8,
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAICompatibleProvider({
      ...configuration,
      supportsJsonSchema: false,
      maxRetries: 0,
    }).generateStructuredOutput(request());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const repairedBody = JSON.parse(
      String((fetchMock.mock.calls[1][1] as RequestInit).body),
    );
    expect(repairedBody.messages.at(-1).content).toContain("Validation issues");
  });

  it("repairs schema drift twice even when a provider advertises JSON Schema", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          choices: [{ message: { content: JSON.stringify({ summary: 42 }) } }],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            { message: { content: JSON.stringify({ confidence: 0.8 }) } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  summary: "Repaired twice",
                  confidence: 0.8,
                }),
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OpenAICompatibleProvider({
      ...configuration,
      supportsJsonSchema: true,
      maxRetries: 0,
    }).generateStructuredOutput(request());

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
