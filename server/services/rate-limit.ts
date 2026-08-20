import { createHash } from "node:crypto";
import { db } from "@/server/db";

export async function consumeRateLimit(
  scope: string,
  key: string,
  limit: number,
  windowMinutes: number,
) {
  const windowMs = windowMinutes * 60_000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const keyHash = createHash("sha256").update(key).digest("hex");
  const entry = await db.securityRateLimit.upsert({
    where: { scope_keyHash_windowStart: { scope, keyHash, windowStart } },
    update: { count: { increment: 1 } },
    create: {
      scope,
      keyHash,
      windowStart,
      expiresAt: new Date(windowStart.getTime() + windowMs * 2),
    },
  });
  return entry.count <= limit;
}
