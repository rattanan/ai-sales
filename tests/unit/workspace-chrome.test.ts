import { describe, expect, it } from "vitest";
import { isChatSurface } from "@/lib/workspace-chrome";

describe("isChatSurface", () => {
  it("treats Universal Chat as a full-bleed app view", () => {
    expect(isChatSurface("/workspace/chat")).toBe(true);
  });

  it("treats a bot conversation as a full-bleed app view", () => {
    expect(isChatSurface("/workspace/chat/cmt3sc1dv001wmha1z9o8crtw")).toBe(
      true,
    );
  });

  it("keeps the measured column on the list pages under the same segment", () => {
    for (const path of [
      "/workspace/chat/saved",
      "/workspace/chat/conversations",
      "/workspace/chat/new",
    ])
      expect(isChatSurface(path)).toBe(false);
  });

  it("keeps the measured column everywhere else", () => {
    for (const path of [
      "/workspace",
      "/workspace/insights/chat-history",
      "/workspace/admin/chat-endpoint",
      "/workspace/chat/cmt3sc1dv001wmha1z9o8crtw/settings",
    ])
      expect(isChatSurface(path)).toBe(false);
  });
});
