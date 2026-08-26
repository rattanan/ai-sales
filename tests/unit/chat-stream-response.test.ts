import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loggerError: vi.fn() }));

vi.mock("@/server/services/logger", () => ({
  logger: { error: mocks.loggerError },
}));

import { chatStreamResponse } from "@/server/http/chat-stream-response";
import { success } from "@/types/result";

describe("chatStreamResponse", () => {
  it("emits visual artifacts as typed SSE events", async () => {
    const response = chatStreamResponse(async (_token, _step, artifact) => {
      artifact({ id: "qr-1", kind: "qr", svg: "<svg/>" });
      return success({ id: "message-1" });
    });

    const body = await response.text();

    expect(body).toContain("event: artifact");
    expect(body).toContain('data: {"id":"qr-1","kind":"qr","svg":"<svg/>"}');
  });

  it("logs safe diagnostics when the chat operation throws", async () => {
    const error = Object.assign(new Error("private provider response"), {
      code: "P2002",
    });
    const response = chatStreamResponse(async () => {
      throw error;
    });

    const body = await response.text();

    expect(body).toContain("event: error");
    expect(body).toContain('"error":"INTERNAL_ERROR"');
    expect(mocks.loggerError).toHaveBeenCalledWith(
      "Chat stream operation failed",
      expect.objectContaining({
        requestId: expect.any(String),
        errorType: "Error",
        errorCode: "P2002",
      }),
    );
    expect(mocks.loggerError.mock.calls[0]?.[1]).not.toHaveProperty("message");
  });
});
