import { describe, expect, it } from "vitest";
import {
  artifactCreateRows,
  liveChatArtifact,
  storedChatArtifacts,
} from "@/server/services/chat-artifact-service";

describe("chat artifact persistence mapping", () => {
  it("omits absent optional fields from structured JSON rows", () => {
    const [qr, chart] = artifactCreateRows([
      {
        id: "qr-1",
        kind: "qr",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
      },
      {
        id: "chart-1",
        kind: "chart",
        svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        type: "bar",
        labels: ["Jan"],
        datasets: [{ data: [10] }],
      },
    ]);

    expect(qr.payload).toEqual({
      svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(chart.payload).not.toHaveProperty("title");
    expect(JSON.stringify([qr.payload, chart.payload])).not.toContain(
      "undefined",
    );
  });

  it("keeps fetched image bytes server-side and returns a same-origin URL", () => {
    const generated = {
      id: "00000000-0000-4000-8000-000000000001",
      kind: "image" as const,
      mediaBytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
      mediaType: "image/png" as const,
      alt: "Product image",
      caption: "Current model",
    };
    const [row] = artifactCreateRows([generated]);

    expect(row.payload).toEqual({
      alt: "Product image",
      caption: "Current model",
    });
    expect(row.payload).not.toHaveProperty("url");
    expect(row.mediaBytes).toEqual(generated.mediaBytes);
    expect(
      storedChatArtifacts([
        {
          id: generated.id,
          kind: "image",
          payload: row.payload,
          mediaBytes: generated.mediaBytes,
          mediaType: "image/png",
        },
      ]),
    ).toEqual([
      {
        id: generated.id,
        kind: "image",
        src: `/api/chat-artifacts/${generated.id}`,
        mediaType: "image/png",
        alt: "Product image",
        caption: "Current model",
      },
    ]);
  });

  it("drops corrupt stored payloads and uses data URLs only for unsaved turns", () => {
    expect(
      storedChatArtifacts([
        {
          id: "bad-chart",
          kind: "chart",
          payload: { svg: "<svg/>" },
        },
      ]),
    ).toEqual([]);
    expect(
      storedChatArtifacts([
        {
          id: "hostile-qr",
          kind: "qr",
          payload: {
            svg: '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
          },
        },
      ]),
    ).toEqual([]);

    expect(
      liveChatArtifact({
        id: "00000000-0000-4000-8000-000000000002",
        kind: "image",
        mediaBytes: new Uint8Array([1, 2, 3]),
        mediaType: "image/png",
        alt: "Fallback",
      }),
    ).toMatchObject({ src: "data:image/png;base64,AQID" });
  });
});
