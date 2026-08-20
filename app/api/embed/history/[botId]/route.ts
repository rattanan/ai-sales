import {
  authenticateExternalSession,
  bearerToken,
  EmbeddedAuthenticationError,
} from "@/server/auth/embedded-auth";
import { db } from "@/server/db";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ botId: string }> },
) {
  const { botId } = await params;
  const token = bearerToken(request);
  if (!token)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  try {
    const { externalSession } = await authenticateExternalSession(token, botId);
    if (!externalSession.conversationId)
      return Response.json(
        { messages: [] },
        { headers: { "cache-control": "no-store" } },
      );
    const messages = await db.chatMessage.findMany({
      where: { conversationId: externalSession.conversationId },
      orderBy: { createdAt: "asc" },
      take: 100,
      include: { citations: { orderBy: { rank: "asc" } } },
    });
    return Response.json(
      {
        conversationId: externalSession.conversationId,
        messages: messages.map((message) => ({
          id: message.id,
          role: message.role,
          content: message.content,
          createdAt: message.createdAt,
          citations: message.citations.map((citation) => ({
            rank: citation.rank,
            quote: citation.quote,
            metadata: citation.metadata,
          })),
        })),
      },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof EmbeddedAuthenticationError;
    return Response.json(
      { error: invalid ? error.code : "INTERNAL_ERROR" },
      { status: invalid ? 401 : 500, headers: { "cache-control": "no-store" } },
    );
  }
}
