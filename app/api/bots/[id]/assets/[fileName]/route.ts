import path from "node:path";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { LocalObjectStorageService } from "@/server/storage/local-storage";

const contentTypes = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; fileName: string }> },
) {
  const { id, fileName } = await params;
  const match = fileName.match(/^([a-f0-9-]{36})\.(jpg|png|webp)$/);
  if (!match) return new Response(null, { status: 404 });
  const assetUrl = `/api/bots/${encodeURIComponent(id)}/assets/${fileName}`;
  const bot = await db.bot.findFirst({
    where: {
      id,
      OR: [{ avatarUrl: assetUrl }, { launcherIcon: assetUrl }],
    },
    select: { id: true },
  });
  if (!bot) return new Response(null, { status: 404 });
  try {
    const storage = new LocalObjectStorageService(
      path.resolve(env().LOCAL_STORAGE_PATH),
    );
    const bytes = await storage.get(match[1]);
    return new Response(bytes, {
      headers: {
        "content-type": contentTypes[match[2] as keyof typeof contentTypes],
        "content-length": String(bytes.length),
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "cross-origin",
      },
    });
  } catch {
    return new Response(null, { status: 404 });
  }
}
