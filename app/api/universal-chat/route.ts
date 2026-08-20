import { universalChatRequestSchema } from "@/schemas/knowledge";
import { getAuthorizationContext } from "@/server/auth/authorization";
import { chatStreamResponse } from "@/server/http/chat-stream-response";
import { sendUniversalChatMessage } from "@/server/services/chat-service";

export const maxDuration = 60;

export async function POST(request: Request) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = universalChatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      {
        error: "VALIDATION_ERROR",
        message: "Check the chat scope and message.",
      },
      { status: 422 },
    );
  try {
    return chatStreamResponse((onToken) =>
      sendUniversalChatMessage(context, { ...parsed.data, onToken }),
    );
  } catch {
    return Response.json(
      {
        error: "INTERNAL_ERROR",
        message: "The message could not be completed. Please try again.",
      },
      { status: 500, headers: { "cache-control": "no-store" } },
    );
  }
}
