import { describe, expect, it } from "vitest";
import { isRetryableEmbeddingBatchError } from "@/packages/knowledge/index-document";

describe("embedding batch fallback", () => {
  it("retries transient provider and network failures with smaller batches", () => {
    expect(
      isRetryableEmbeddingBatchError(
        new Error("Endpoint returned HTTP 502: upstream unavailable"),
      ),
    ).toBe(true);
    expect(isRetryableEmbeddingBatchError(new Error("fetch failed"))).toBe(
      true,
    );
  });

  it("does not split batches for invalid endpoint configuration", () => {
    expect(
      isRetryableEmbeddingBatchError(
        new Error("Endpoint returned HTTP 400: invalid model"),
      ),
    ).toBe(false);
    expect(
      isRetryableEmbeddingBatchError(
        new Error("Embedding provider returned an invalid vector"),
      ),
    ).toBe(false);
  });
});
