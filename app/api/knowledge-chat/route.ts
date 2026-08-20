import { getAuthorizationContext } from "@/server/auth/authorization";
import { chatRequestSchema } from "@/schemas/knowledge";
import { chatStreamResponse } from "@/server/http/chat-stream-response";
import { sendKnowledgeChatMessage } from "@/server/services/chat-service";

export const maxDuration = 60;

export async function POST(request: Request) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  const parsed = chatRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "VALIDATION_ERROR", message: "Enter a valid message." },
      { status: 400 },
    );
  try {
    return chatStreamResponse((onToken) =>
      sendKnowledgeChatMessage(context, {
        ...parsed.data,
        authMode: context.authMode ?? "LOCAL",
        onToken,
      }),
    );
  } catch (error) {
    const notFound = error instanceof Error && error.message === "NOT_FOUND";
    return Response.json(
      {
        error: notFound ? "NOT_FOUND" : "INTERNAL_ERROR",
        message: notFound
          ? "Bot not found."
          : "The message could not be completed.",
      },
      { status: notFound ? 404 : 500 },
    );
  }
}
