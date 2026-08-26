import { describe, expect, it } from "vitest";
import { aiEndpointSchema } from "@/schemas/ai-endpoint";

const chatEndpoint = {
  credentialPresent: false,
  name: "GPT-OSS",
  kind: "CHAT" as const,
  providerType: "OPENAI_COMPATIBLE" as const,
  baseUrl: "https://ai.example/v1/chat/completions",
  model: "openai/gpt-oss-120b",
  temperature: 0.3,
  maxTokens: 4096,
  timeoutMs: 180_000,
  maxRetries: 2,
  active: "on",
};

describe("ai endpoint capability flags", () => {
  it("reads a ticked checkbox from FormData", () => {
    const result = aiEndpointSchema.safeParse({
      ...chatEndpoint,
      supportsToolCalling: "on",
      supportsReasoningEffort: "on",
    });

    expect(result.success).toBe(true);
    expect(result.data?.supportsToolCalling).toBe(true);
    expect(result.data?.supportsReasoningEffort).toBe(true);
  });

  it("treats an absent checkbox as off rather than failing", () => {
    // An unticked checkbox is simply missing from the submitted FormData. Before
    // these flags had a form at all they could only be set by hand in SQL, which
    // is how a deployed endpoint ended up unable to run an agentic turn.
    const result = aiEndpointSchema.safeParse(chatEndpoint);

    expect(result.success).toBe(true);
    expect(result.data?.supportsToolCalling).toBe(false);
    expect(result.data?.supportsReasoningEffort).toBe(false);
  });

  it("accepts the flags on an embedding endpoint but they carry no meaning", () => {
    // The form hides them for embeddings; the service stores false regardless,
    // so a submitted value cannot leave a stale capability behind.
    const result = aiEndpointSchema.safeParse({
      credentialPresent: false,
      name: "Local A30",
      kind: "EMBEDDING",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://ai.example/v1/embeddings",
      model: "Qwen/Qwen3-Embedding-4B",
      batchSize: 16,
      timeoutMs: 120_000,
      maxRetries: 2,
      active: "on",
      supportsToolCalling: "on",
    });

    expect(result.success).toBe(true);
  });
});
