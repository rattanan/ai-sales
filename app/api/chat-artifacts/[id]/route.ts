import { getAuthorizationContext } from "@/server/auth/authorization";
import {
  authenticateExternalSession,
  bearerToken,
} from "@/server/auth/embedded-auth";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function notFound() {
  return new Response("Not found", {
    status: 404,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[a-f0-9-]{36}$/i.test(id)) return notFound();

  const artifact = await db.chatMessageArtifact.findUnique({
    where: { id },
    select: {
      kind: true,
      mediaType: true,
      message: {
        select: {
          conversationId: true,
          conversation: {
            select: {
              organizationId: true,
              userId: true,
              botId: true,
              deletedAt: true,
            },
          },
        },
      },
    },
  });
  if (
    !artifact ||
    artifact.kind !== "image" ||
    !artifact.mediaType ||
    !ALLOWED_IMAGE_TYPES.has(artifact.mediaType) ||
    artifact.message.conversation.deletedAt
  )
    return notFound();

  try {
    const token = bearerToken(request);
    if (token) {
      const { externalSession } = await authenticateExternalSession(
        token,
        artifact.message.conversation.botId,
      );
      if (
        externalSession.conversationId !== artifact.message.conversationId ||
        externalSession.organizationId !==
          artifact.message.conversation.organizationId
      )
        return notFound();
    } else {
      const context = await getAuthorizationContext();
      if (!context) return notFound();
      await requirePermission(context, "chat.use");
      if (
        context.organizationId !==
          artifact.message.conversation.organizationId ||
        context.userId !== artifact.message.conversation.userId
      )
        return notFound();
    }
  } catch {
    return notFound();
  }

  const media = await db.chatMessageArtifact.findUnique({
    where: { id },
    select: { mediaBytes: true },
  });
  if (!media?.mediaBytes?.length) return notFound();

  return new Response(new Uint8Array(media.mediaBytes), {
    headers: {
      "content-type": artifact.mediaType,
      "content-length": String(media.mediaBytes.length),
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="chat-image-${id}.${artifact.mediaType.split("/")[1]}"`,
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
}
