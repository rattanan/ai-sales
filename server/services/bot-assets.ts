export const MAX_BOT_IMAGE_BYTES = 2 * 1024 * 1024;

export type BotImageType = {
  extension: "jpg" | "png" | "webp";
  mimeType: "image/jpeg" | "image/png" | "image/webp";
};

export function detectBotImageType(bytes: Uint8Array): BotImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  )
    return { extension: "png", mimeType: "image/png" };

  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  )
    return { extension: "jpg", mimeType: "image/jpeg" };

  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  )
    return { extension: "webp", mimeType: "image/webp" };

  return null;
}

export function botAssetUrl(
  botId: string,
  key: string,
  extension: BotImageType["extension"],
) {
  return `/api/bots/${encodeURIComponent(botId)}/assets/${key}.${extension}`;
}

export function localBotAssetKey(value: string | null | undefined) {
  const match = value?.match(
    /^\/api\/bots\/[^/]+\/assets\/([a-f0-9-]{36})\.(?:jpg|png|webp)$/,
  );
  return match?.[1];
}
