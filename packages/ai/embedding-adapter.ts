export type EmbeddingProviderType = "OPENAI_COMPATIBLE" | "OLLAMA";

export type EmbeddingAdapter = {
  endpoint(baseUrl: string): string;
  request(model: string, input: string | string[]): Record<string, unknown>;
  vectors(payload: unknown): number[][];
};

function finiteVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

function payloadObject(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    throw new Error("Embedding provider returned an invalid JSON payload");
  return payload as Record<string, unknown>;
}

const openAiCompatibleAdapter: EmbeddingAdapter = {
  endpoint(baseUrl) {
    const base = baseUrl.replace(/\/$/, "");
    return /\/embeddings$/.test(base) ? base : `${base}/embeddings`;
  },
  request(model, input) {
    return { model, input };
  },
  vectors(payload) {
    const data = payloadObject(payload).data;
    if (!Array.isArray(data))
      throw new Error("Embedding provider response is missing data");
    const vectors = data
      .map((item, position) => {
        if (!item || typeof item !== "object" || Array.isArray(item))
          return { index: position, embedding: undefined };
        const row = item as Record<string, unknown>;
        return {
          index: typeof row.index === "number" ? row.index : position,
          embedding: row.embedding,
        };
      })
      .sort((left, right) => left.index - right.index)
      .map(({ embedding }) => embedding);
    if (!vectors.every(finiteVector))
      throw new Error("Embedding provider returned an invalid vector");
    return vectors as number[][];
  },
};

const ollamaAdapter: EmbeddingAdapter = {
  endpoint(baseUrl) {
    const base = baseUrl.replace(/\/$/, "");
    return /\/api\/embed$/.test(base) ? base : `${base}/api/embed`;
  },
  request(model, input) {
    return { model, input };
  },
  vectors(payload) {
    const embeddings = payloadObject(payload).embeddings;
    if (!Array.isArray(embeddings) || !embeddings.every(finiteVector))
      throw new Error("Ollama returned an invalid embeddings array");
    return embeddings as number[][];
  },
};

export function embeddingAdapter(providerType: EmbeddingProviderType) {
  return providerType === "OLLAMA" ? ollamaAdapter : openAiCompatibleAdapter;
}

export function inferEmbeddingProviderType(
  providerType: string | null | undefined,
  endpoint: string,
): EmbeddingProviderType {
  return providerType === "OLLAMA" || /\/api\/embed\/?$/.test(endpoint)
    ? "OLLAMA"
    : "OPENAI_COMPATIBLE";
}

export function assertEmbeddingCount(vectors: number[][], expected: number) {
  if (vectors.length !== expected)
    throw new Error("Embedding provider returned an unexpected batch size");
  return vectors;
}
