import { embeddedChatRequestSchema } from "@/schemas/authentication";
import {
  authenticateExternalSession,
  bearerToken,
  EmbeddedAuthenticationError,
} from "@/server/auth/embedded-auth";
import { db } from "@/server/db";
import { sendKnowledgeChatMessage } from "@/server/services/chat-service";
import { consumeRateLimit } from "@/server/services/rate-limit";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const token = bearerToken(request);
  if (!token)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = embeddedChatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "VALIDATION_ERROR", message: "Enter a valid message." },
      { status: 400 },
    );
  try {
    const { context, externalSession } = await authenticateExternalSession(
      token,
      botId,
    );
    const allowed = await consumeRateLimit(
      "embedded-widget-chat",
      `${botId}:${externalSession.origin}:${context.userId}:${externalSession.externalSessionId}`,
      20,
      1,
    );
    if (!allowed)
      return Response.json(
        {
          error: "AI_RATE_LIMITED",
          message: "Too many messages. Try again shortly.",
        },
        { status: 429 },
      );
    const result = await sendKnowledgeChatMessage(context, {
      botId,
      conversationId: externalSession.conversationId ?? undefined,
      authMode: externalSession.authMode,
      message: parsed.data.message,
    });
    if (!result.ok)
      return Response.json(
        { error: result.error.code, message: result.error.message },
        {
          status:
            result.error.code === "AI_RATE_LIMITED"
              ? 429
              : result.error.code === "NOT_FOUND"
                ? 404
                : 400,
        },
      );
    if (externalSession.conversationId !== result.data.conversation.id)
      await db.externalSession.update({
        where: { id: externalSession.id },
        data: { conversationId: result.data.conversation.id },
      });
    return Response.json(result.data, {
      headers: { "cache-control": "no-store" },
    });
  } catch (error) {
    const invalid = error instanceof EmbeddedAuthenticationError;
    return Response.json(
      {
        error: invalid ? error.code : "INTERNAL_ERROR",
        message: invalid
          ? "Widget session expired or invalid."
          : "The message could not be completed.",
      },
      { status: invalid ? 401 : 500, headers: { "cache-control": "no-store" } },
    );
  }
}
