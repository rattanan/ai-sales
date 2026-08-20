import { describe, expect, it } from "vitest";
import {
  assertEmbeddingCount,
  embeddingAdapter,
  inferEmbeddingProviderType,
} from "@/packages/ai/embedding-adapter";
import {
  sourceAssignmentSchema,
  universalChatRequestSchema,
} from "@/schemas/knowledge";
import { aiEndpointSchema } from "@/schemas/ai-endpoint";

describe("enterprise embedding endpoint adapters", () => {
  it("normalizes and parses Ollama native /api/embed responses", () => {
    const adapter = embeddingAdapter("OLLAMA");
    expect(adapter.endpoint("https://embedding.example")).toBe(
      "https://embedding.example/api/embed",
    );
    expect(adapter.endpoint("https://embedding.example/api/embed")).toBe(
      "https://embedding.example/api/embed",
    );
    expect(adapter.request("model-a", ["one", "two"])).toEqual({
      model: "model-a",
      input: ["one", "two"],
    });
    expect(
      assertEmbeddingCount(
        adapter.vectors({
          embeddings: [
            [0.1, 0.2],
            [0.3, 0.4],
          ],
        }),
        2,
      ),
    ).toHaveLength(2);
  });

  it("orders OpenAI-compatible vectors by response index and rejects bad dimensions", () => {
    const adapter = embeddingAdapter("OPENAI_COMPATIBLE");
    expect(
      adapter.vectors({
        data: [
          { index: 1, embedding: [0.3, 0.4] },
          { index: 0, embedding: [0.1, 0.2] },
        ],
      }),
    ).toEqual([
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    expect(() => assertEmbeddingCount([[0.1]], 2)).toThrow(
      /unexpected batch size/,
    );
    expect(inferEmbeddingProviderType(undefined, "https://x/api/embed")).toBe(
      "OLLAMA",
    );
  });
});

describe("enterprise chat and source contracts", () => {
  const base = { message: "Find the policy", mode: "AUTO" as const };

  it("accepts SMART and ALL_ACCESSIBLE while requiring explicit selections", () => {
    expect(
      universalChatRequestSchema.safeParse({
        ...base,
        scope: "SMART",
        sourceIds: [],
      }).success,
    ).toBe(true);
    expect(
      universalChatRequestSchema.safeParse({
        ...base,
        scope: "ALL_ACCESSIBLE",
        sourceIds: [],
      }).success,
    ).toBe(true);
    expect(
      universalChatRequestSchema.safeParse({
        ...base,
        scope: "SPECIFIC_BOT",
        sourceIds: [],
      }).success,
    ).toBe(false);
    expect(
      universalChatRequestSchema.safeParse({
        ...base,
        scope: "SPECIFIC_SOURCES",
        sourceIds: [],
      }).success,
    ).toBe(false);
  });

  it("requires at least one bot for SELECTED_BOTS source scope", () => {
    expect(
      sourceAssignmentSchema.safeParse({
        sourceType: "KNOWLEDGE",
        sourceId: "source-1",
        scope: "SELECTED_BOTS",
        botIds: [],
        enabled: true,
        priority: 100,
      }).success,
    ).toBe(false);
    expect(
      sourceAssignmentSchema.safeParse({
        sourceType: "KNOWLEDGE",
        sourceId: "source-1",
        scope: "GLOBAL",
        botIds: [],
        enabled: true,
        priority: 100,
      }).success,
    ).toBe(true);
  });

  it("keeps Chat and Embedding configuration contracts distinct", () => {
    const common = {
      credentialPresent: false,
      name: "Production endpoint",
      baseUrl: "https://ai.example/v1",
      model: "configured-model",
      timeoutMs: 30_000,
      maxRetries: 2,
      active: true,
    };
    expect(
      aiEndpointSchema.safeParse({
        ...common,
        kind: "CHAT",
        providerType: "OPENAI_COMPATIBLE",
        temperature: 0.1,
        maxTokens: 4096,
      }).success,
    ).toBe(true);
    expect(
      aiEndpointSchema.safeParse({
        ...common,
        kind: "EMBEDDING",
        providerType: "OLLAMA",
        batchSize: 16,
        vectorDimension: 2560,
      }).success,
    ).toBe(true);
  });

  it("accepts an empty optional vector dimension from FormData", () => {
    const result = aiEndpointSchema.safeParse({
      credentialPresent: "false",
      name: "Production embeddings",
      kind: "EMBEDDING",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://ai.example/v1",
      model: "configured-model",
      apiKey: "",
      batchSize: "16",
      vectorDimension: "",
      temperature: "0",
      maxTokens: "128",
      timeoutMs: "120000",
      maxRetries: "2",
      active: "on",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.vectorDimension).toBeUndefined();
  });

  it("rejects a native Gemini operation suffix for OpenAI-compatible embeddings", () => {
    const result = aiEndpointSchema.safeParse({
      credentialPresent: true,
      name: "Gemini embeddings",
      kind: "EMBEDDING",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      model: "gemini-embedding-2:embedContent",
      batchSize: 16,
      vectorDimension: 768,
      timeoutMs: 120_000,
      maxRetries: 2,
      active: true,
    });

    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.error.flatten().fieldErrors.model?.[0]).toContain(
        "remove ':embedContent'",
      );
  });
});
