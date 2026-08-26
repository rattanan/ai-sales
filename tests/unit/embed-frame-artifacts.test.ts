import { Script } from "node:vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findFirst: vi.fn() }));

vi.mock("@/server/db", () => ({
  db: { bot: { findFirst: mocks.findFirst } },
}));

import { GET } from "@/app/api/embed/frame/[botId]/route";

describe("embedded frame visual artifacts", () => {
  beforeEach(() => {
    mocks.findFirst.mockResolvedValue({
      id: "bot-1",
      name: "Sales assistant",
      welcomeMessage: "Hello",
      suggestedQuestions: ["Show sales"],
      primaryColor: "#ffd400",
      headerColor: "#24221c",
      chatBubbleColor: "#fff5b8",
      fontFamily: "system",
      colorMode: "LIGHT",
      avatarUrl: null,
      brandingEnabled: true,
      organization: {
        authenticationPolicy: {
          embeddedEnabled: true,
          embeddedConfig: {
            active: true,
            allowedOrigins: ["https://portal.example.com"],
          },
        },
      },
    });
  });

  it("ships parseable artifact UI and permits only same-frame blob images", async () => {
    const response = await GET(new Request("https://app.example.com/frame"), {
      params: Promise.resolve({ botId: "bot-1" }),
    });
    const body = await response.text();
    const script = body.match(
      /<script nonce="[^"]+">([\s\S]*?)<\/script>/,
    )?.[1];

    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain(
      "img-src 'self' data: blob:",
    );
    expect(body).toContain("function renderArtifact");
    expect(script).toBeTruthy();
    expect(() => new Script(script!)).not.toThrow();
  });
});
