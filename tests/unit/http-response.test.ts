import { describe, expect, it } from "vitest";
import { readJsonResponse } from "@/lib/http-response";

describe("readJsonResponse", () => {
  it("reads a valid JSON response", async () => {
    const response = Response.json({ message: "ok" });

    await expect(
      readJsonResponse<{ message: string }>(response, "Request failed."),
    ).resolves.toEqual({ message: "ok" });
  });

  it.each([
    ["an empty response", new Response(null, { status: 500 })],
    [
      "a non-JSON response",
      new Response("Service unavailable", {
        status: 502,
        headers: { "content-type": "text/plain" },
      }),
    ],
  ])("uses a stable error for %s", async (_label, response) => {
    await expect(
      readJsonResponse(response, "The message could not be completed."),
    ).rejects.toThrow("The message could not be completed.");
  });
});
