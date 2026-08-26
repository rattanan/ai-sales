import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  activeAiEndpoint: vi.fn(),
  getAiEndpointSecret: vi.fn(),
  resolvedAiEndpointUrl: vi.fn(),
  getProviderSecret: vi.fn(),
  fetchAiWithRetry: vi.fn(),
  llmProviderFindFirst: vi.fn(),
}));

vi.mock("@/server/services/ai-endpoint-service", () => ({
  activeAiEndpoint: mocks.activeAiEndpoint,
  getAiEndpointSecret: mocks.getAiEndpointSecret,
  resolvedAiEndpointUrl: mocks.resolvedAiEndpointUrl,
}));
vi.mock("@/server/services/llm-provider-config", () => ({
  getProviderSecret: mocks.getProviderSecret,
}));
vi.mock("@/packages/ai/fetch-with-retry", () => ({
  fetchAiWithRetry: mocks.fetchAiWithRetry,
}));
vi.mock("@/server/db", () => ({
  db: { llmProvider: { findFirst: mocks.llmProviderFindFirst } },
}));

import {
  EmbeddingProviderCooldownError,
  embedKnowledgeQuery,
  resetEmbeddingCooldown,
} from "@/server/services/embedding-service";

describe("embedding provider cooldown", () => {
  beforeEach(() => {
    resetEmbeddingCooldown();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.activeAiEndpoint.mockResolvedValue({
      id: "endpoint-1",
      model: "qwen3-embedding:4b",
      providerType: "OPENAI_COMPATIBLE",
      timeoutMs: 10_000,
      maxRetries: 2,
    });
    mocks.resolvedAiEndpointUrl.mockReturnValue(
      "http://embeddings.invalid/v1/embeddings",
    );
    mocks.getAiEndpointSecret.mockResolvedValue("key");
    mocks.llmProviderFindFirst.mockResolvedValue(null);
  });

  it("stops re-attempting a provider that just failed", async () => {
    // The real cost is the timeout: an unreachable provider took ~32s per call,
    // and an agentic turn searching five times used to pay it five times.
    mocks.fetchAiWithRetry.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(embedKnowledgeQuery("org-1", "หนึ่ง")).rejects.toThrow(
      "ETIMEDOUT",
    );
    await expect(embedKnowledgeQuery("org-1", "สอง")).rejects.toThrow(
      EmbeddingProviderCooldownError,
    );
    await expect(embedKnowledgeQuery("org-1", "สาม")).rejects.toThrow(
      EmbeddingProviderCooldownError,
    );

    // Only the first call reached the network.
    expect(mocks.fetchAiWithRetry).toHaveBeenCalledTimes(1);
  });

  it("keeps one organization's outage out of another's requests", async () => {
    mocks.fetchAiWithRetry.mockRejectedValue(new Error("ETIMEDOUT"));

    await expect(embedKnowledgeQuery("org-1", "x")).rejects.toThrow(
      "ETIMEDOUT",
    );
    await expect(embedKnowledgeQuery("org-2", "x")).rejects.toThrow(
      "ETIMEDOUT",
    );

    expect(mocks.fetchAiWithRetry).toHaveBeenCalledTimes(2);
  });

  it("lets a working provider through untouched", async () => {
    // A Response body reads once, so each call needs its own instance.
    mocks.fetchAiWithRetry.mockImplementation(async () =>
      Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] }),
    );

    const first = await embedKnowledgeQuery("org-1", "หนึ่ง");
    const second = await embedKnowledgeQuery("org-1", "สอง");

    expect(first.embedding).toHaveLength(3);
    expect(second.embedding).toHaveLength(3);
    expect(mocks.fetchAiWithRetry).toHaveBeenCalledTimes(2);
  });

  it("resumes after the cooldown is cleared", async () => {
    mocks.fetchAiWithRetry.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    await expect(embedKnowledgeQuery("org-1", "x")).rejects.toThrow(
      "ETIMEDOUT",
    );

    resetEmbeddingCooldown("org-1");
    mocks.fetchAiWithRetry.mockImplementation(async () =>
      Response.json({ data: [{ embedding: [0.5] }] }),
    );

    await expect(embedKnowledgeQuery("org-1", "x")).resolves.toMatchObject({
      embedding: [0.5],
    });
  });
});
