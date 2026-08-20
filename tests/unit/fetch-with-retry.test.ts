import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAiWithRetry } from "@/packages/ai/fetch-with-retry";

describe("AI request retry pacing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("honors Retry-After when the provider rate limits a request", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        }),
      )
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));

    const responsePromise = fetchAiWithRetry(
      "https://ai.example.test/embeddings",
      { method: "POST" },
      { timeoutMs: 5_000, maxRetries: 1 },
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(responsePromise).resolves.toMatchObject({ status: 200 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the network cause after retries are exhausted", async () => {
    const networkError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket closed"), { code: "ECONNRESET" }),
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(networkError);

    await expect(
      fetchAiWithRetry(
        "https://ai.example.test/embeddings",
        { method: "POST" },
        { timeoutMs: 5_000, maxRetries: 0 },
      ),
    ).rejects.toThrow(
      "AI endpoint request failed: ECONNRESET: socket closed",
    );
  });
});
