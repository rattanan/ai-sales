import { describe, expect, it } from "vitest";
import {
  botAppearanceSchema,
  botConfigurationSchema,
} from "@/schemas/knowledge";
import {
  botAssetUrl,
  detectBotImageType,
  localBotAssetKey,
} from "@/server/services/bot-assets";
import {
  isStandardBotIconPath,
  standardBotIconId,
  standardBotIconPath,
} from "@/lib/bot-icons";

describe("bot appearance", () => {
  it("validates bounded theme and size settings", () => {
    const valid = botAppearanceSchema.safeParse({
      botId: "bot-1",
      primaryColor: "#4f46e5",
      headerColor: "#312e81",
      chatBubbleColor: "#eef2ff",
      fontFamily: "system",
      colorMode: "AUTO",
      widgetSize: "STANDARD",
      launcherSize: "56",
      windowPosition: "RIGHT",
      brandingEnabled: "on",
      avatarStandardIcon: "brain",
      launcherStandardIcon: "message",
    });
    expect(valid.success).toBe(true);
    if (valid.success) {
      expect(valid.data.avatarStandardIcon).toBe("brain");
      expect(valid.data.launcherStandardIcon).toBe("message");
    }
    expect(
      botAppearanceSchema.safeParse({
        ...(valid.success ? valid.data : {}),
        launcherSize: 120,
      }).success,
    ).toBe(false);
  });

  it("round-trips standard icon paths", () => {
    const path = standardBotIconPath("headset");
    expect(path).toBe("/bot-icons/headset.svg");
    expect(isStandardBotIconPath(path)).toBe(true);
    expect(standardBotIconId(path)).toBe("headset");
    expect(standardBotIconId("/bot-icons/unknown.svg")).toBeUndefined();
    expect(
      botAppearanceSchema.safeParse({
        botId: "bot-1",
        primaryColor: "#4f46e5",
        headerColor: "#312e81",
        chatBubbleColor: "#eef2ff",
        fontFamily: "system",
        colorMode: "AUTO",
        widgetSize: "STANDARD",
        launcherSize: "56",
        windowPosition: "RIGHT",
        avatarStandardIcon: "unknown",
      }).success,
    ).toBe(false);
  });

  it("accepts only supported image signatures", () => {
    expect(
      detectBotImageType(
        Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toEqual({ extension: "png", mimeType: "image/png" });
    expect(
      detectBotImageType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])),
    ).toEqual({ extension: "jpg", mimeType: "image/jpeg" });
    expect(
      detectBotImageType(new TextEncoder().encode("<svg></svg>")),
    ).toBeNull();
  });

  it("round-trips local bot asset keys", () => {
    const key = "01234567-89ab-cdef-0123-456789abcdef";
    const url = botAssetUrl("bot-1", key, "webp");
    expect(url).toBe(`/api/bots/bot-1/assets/${key}.webp`);
    expect(localBotAssetKey(url)).toBe(key);
    expect(localBotAssetKey("https://example.com/avatar.png")).toBeUndefined();
  });

  it("rejects malformed local asset paths in full bot configuration", () => {
    const avatarField = botConfigurationSchema.shape.avatarUrl;
    expect(avatarField.safeParse("/bot-icons/bot.svg")).toMatchObject({
      success: true,
    });
    expect(
      avatarField.safeParse('/api/bots/x/assets/image.png\");color:red'),
    ).toMatchObject({ success: false });
  });
});
