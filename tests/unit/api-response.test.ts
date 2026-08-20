import { describe, expect, it } from "vitest";
import { apiFailure, apiSuccess } from "@/server/http/api-response";

describe("API v1 response contract", () => {
  it("preserves a valid caller request ID in success responses", async () => {
    const response = apiSuccess(
      new Request("http://insightkm.test/api/v1/health", {
        headers: { "x-request-id": "request-12345678" },
      }),
      { status: "ok" },
    );
    expect(response.headers.get("x-request-id")).toBe("request-12345678");
    await expect(response.json()).resolves.toMatchObject({
      data: { status: "ok" },
      meta: { requestId: "request-12345678" },
      error: null,
    });
  });

  it("replaces unsafe request IDs and returns stable error shapes", async () => {
    const response = apiFailure(
      new Request("http://insightkm.test/api/v1/example", {
        headers: { "x-request-id": "bad value" },
      }),
      { code: "VALIDATION_ERROR", message: "Check the request." },
      { status: 422 },
    );
    const body = await response.json();
    expect(response.status).toBe(422);
    expect(body.data).toBeNull();
    expect(body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Check the request.",
    });
    expect(body.meta.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
