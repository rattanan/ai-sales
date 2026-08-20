import { describe, expect, it } from "vitest";
import { providerHttpError } from "@/packages/ai/provider-http-error";

describe("provider HTTP errors", () => {
  it("includes a structured provider message", async () => {
    const response = new Response(
      JSON.stringify({
        error: {
          code: 400,
          message: "Model gemini-embedding-2:embedContent was not found",
        },
      }),
      { status: 400 },
    );

    await expect(providerHttpError(response)).resolves.toBe(
      "Endpoint returned HTTP 400: Model gemini-embedding-2:embedContent was not found",
    );
  });

  it("redacts credentials and ignores unstructured response bodies", async () => {
    const secret = "AIza012345678901234567890123456789012345";
    const structured = new Response(
      JSON.stringify({ error: { message: `Invalid API key ${secret}` } }),
      { status: 401 },
    );
    const unstructured = new Response("<html>Gateway failure</html>", {
      status: 502,
    });

    expect(await providerHttpError(structured)).toBe(
      "Endpoint returned HTTP 401: Invalid API key [REDACTED]",
    );
    expect(await providerHttpError(unstructured)).toBe(
      "Endpoint returned HTTP 502",
    );
  });
});
