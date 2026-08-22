import { afterEach, describe, expect, it, vi } from "vitest";
import {
  normalizeWebSearchResults,
  searchWeb,
} from "@/server/services/web-search";

describe("chat web search", () => {
  afterEach(() => vi.restoreAllMocks());

  it("normalizes valid results and rejects unsafe or empty entries", () => {
    const results = normalizeWebSearchResults({
      results: [
        {
          title: "Current source",
          url: "https://example.com/latest",
          content: "Fresh source content",
          score: 0.82,
        },
        { url: "javascript:alert(1)", content: "unsafe" },
        { url: "https://example.com/empty", content: "  " },
      ],
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      documentName: "Current source",
      content: "Fresh source content",
      score: 0.82,
      metadata: {
        sourceType: "WEB_SEARCH",
        url: "https://example.com/latest",
      },
    });
  });

  it("calls the configured Tavily-compatible endpoint with bounded options", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        results: [
          {
            title: "Result",
            url: "https://example.com/result",
            content: "Result body",
            score: 0.9,
          },
        ],
      }),
    );

    await expect(
      searchWeb("latest policy", {
        apiKey: "test-key",
        baseUrl: "https://search.example.test/",
        timeoutMs: 5_000,
        maxResults: 4,
      }),
    ).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://search.example.test/search",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-key",
        }),
        body: JSON.stringify({
          query: "latest policy",
          search_depth: "basic",
          include_answer: false,
          include_raw_content: false,
          max_results: 4,
        }),
      }),
    );
  });

  it("reports non-success provider responses", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );
    await expect(
      searchWeb("query", {
        apiKey: "test-key",
        baseUrl: "https://search.example.test",
        timeoutMs: 5_000,
        maxResults: 5,
      }),
    ).rejects.toThrow("WEB_SEARCH_HTTP_429");
  });
});
