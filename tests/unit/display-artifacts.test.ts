import { describe, expect, it } from "vitest";
import type { AgentRunContext } from "@/server/ai/agent/types";
import {
  displayChart,
  displayQr,
} from "@/server/ai/agent/system-tools/display";
import {
  appendDisplayGrounding,
  displayNumbersAreGrounded,
  displayTextIsGrounded,
} from "@/server/ai/display-artifacts/grounding";
import { fetchDisplayImage } from "@/server/ai/display-artifacts/image-fetch";
import {
  normalizeQrPayload,
  renderQrSvg,
} from "@/server/ai/display-artifacts/qr-renderer";
import { renderChartSvg } from "@/server/ai/display-artifacts/chart-renderer";

function context(grounding: string, count = 0) {
  return {
    displayGroundingText: grounding,
    displayArtifactCount: count,
  } as AgentRunContext;
}

describe("display artifact grounding", () => {
  it("requires exact text and numeric facts that appeared in prior context", () => {
    const grounding = appendDisplayGrounding(
      "invoice https://cdn.example.com/item.png",
      "Jan 1,250.50 Feb -20",
    );

    expect(
      displayTextIsGrounded(grounding, "https://cdn.example.com/item.png"),
    ).toBe(true);
    expect(displayTextIsGrounded(grounding, "https://evil.example/a.png")).toBe(
      false,
    );
    expect(displayNumbersAreGrounded(grounding, [1250.5, -20])).toBe(true);
    expect(displayNumbersAreGrounded(grounding, [1250.5, 21])).toBe(false);
  });

  it("rejects an invented chart value and a fourth visual", async () => {
    const invented = await displayChart.execute(context("Jan 10 Feb 20"), {
      type: "bar",
      labels: ["Jan", "Feb"],
      datasets: [{ data: [10, 21] }],
    });
    const overQuota = await displayQr.execute(
      context("https://example.com", 3),
      {
        data: "https://example.com",
      },
    );

    expect(invented).toMatchObject({
      isError: true,
      errorCode: "DISPLAY_NOT_GROUNDED",
    });
    expect(overQuota).toMatchObject({
      isError: true,
      errorCode: "DISPLAY_ARTIFACT_LIMIT",
    });
  });

  it("validates chart dimensions instead of fabricating missing values", () => {
    const parsed = displayChart.parameters.safeParse({
      type: "line",
      labels: ["Jan", "Feb"],
      datasets: [{ data: [10] }],
    });

    expect(parsed.success).toBe(false);
  });
});

describe("trusted SVG renderers", () => {
  it("normalizes bill-payment fields and emits scanner-safe SVG", () => {
    const payload = normalizeQrPayload("| 123 456 789");
    const svg = renderQrSvg(payload);

    expect(payload).toBe("|123\n456\n789");
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).not.toContain("<script");
  });

  it("escapes model-provided labels and cycles a bounded color palette", () => {
    const svg = renderChartSvg({
      type: "pie",
      labels: Array.from({ length: 8 }, (_, index) => `<label-${index}>`),
      datasets: [{ data: [1, 2, 3, 4, 5, 6, 7, 8] }],
      title: '<script>alert("x")</script>',
    });

    expect(svg).toContain("&lt;label-7&gt;");
    expect(svg).toContain("&lt;script&gt;");
    expect(svg).toContain('width="640" height="360" fill="#ffffff"');
    expect(svg).not.toContain("<script>");
    expect(svg).not.toContain('fill="undefined"');
  });
});

describe("display image boundary", () => {
  it("accepts a DNS-pinned, byte-sniffed PNG without returning its source URL", async () => {
    const result = await fetchDisplayImage("https://cdn.example.com/item.png", {
      validateUrl: async (rawUrl) => ({
        url: new URL(rawUrl),
        address: "8.8.8.8",
        family: 4,
      }),
      requestOnce: async () => ({
        status: 200,
        headers: { "content-type": "image/png" },
        bytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      }),
    });

    expect(result.mediaType).toBe("image/png");
    expect(result.bytes).toHaveLength(8);
    expect(result).not.toHaveProperty("url");
  });

  it("denies cross-origin redirects before fetching the second host", async () => {
    await expect(
      fetchDisplayImage("https://cdn.example.com/item.png", {
        validateUrl: async (rawUrl) => ({
          url: new URL(rawUrl),
          address: "8.8.8.8",
          family: 4,
        }),
        requestOnce: async () => ({
          status: 302,
          headers: { location: "https://other.example/image.png" },
          bytes: Buffer.alloc(0),
        }),
      }),
    ).rejects.toMatchObject({
      code: "REDIRECT_DENIED",
    });
  });
});
