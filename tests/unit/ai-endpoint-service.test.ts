import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { testAiEndpoint } from "@/server/services/ai-endpoint-service";

const dbMocks = vi.hoisted(() => ({
  findEndpoint: vi.fn(),
  updateEndpoint: vi.fn(),
  findCredential: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    aiEndpointConfig: {
      findFirst: dbMocks.findEndpoint,
      update: dbMocks.updateEndpoint,
    },
    aiEndpointCredential: { findUnique: dbMocks.findCredential },
  },
}));

const context = {
  organizationId: "organization-1",
} as AuthorizationContext;

describe("AI endpoint health check", () => {
  beforeEach(() => {
    dbMocks.findEndpoint.mockResolvedValue({
      id: "chat-endpoint-1",
      organizationId: context.organizationId,
      kind: "CHAT",
      providerType: "OPENAI_COMPATIBLE",
      baseUrl: "https://provider.example/v1/chat/completions",
      model: "openai/gpt-oss-120b",
      timeoutMs: 10_000,
    });
    dbMocks.findCredential.mockResolvedValue(null);
    dbMocks.updateEndpoint.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reserves enough completion tokens for reasoning models to answer", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        choices: [{ message: { content: "OK" }, finish_reason: "stop" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await testAiEndpoint(context, "chat-endpoint-1");

    expect(result.ok).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "openai/gpt-oss-120b",
      max_tokens: 128,
      temperature: 0,
    });
    expect(dbMocks.updateEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ lastHealthStatus: "HEALTHY" }),
      }),
    );
  });
});
