import { getAuthorizationContext } from "@/server/auth/authorization";
import { chatRequestSchema } from "@/schemas/knowledge";
import { chatStreamResponse } from "@/server/http/chat-stream-response";
import { readChatRequest } from "@/server/http/chat-request";
import { sendKnowledgeChatMessage } from "@/server/services/chat-service";
import { ChatAttachmentRequestError } from "@/server/services/chat-attachment-service";

export const maxDuration = 60;

export async function POST(request: Request) {
  const context = await getAuthorizationContext();
  if (!context)
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  let chatRequest: Awaited<ReturnType<typeof readChatRequest>>;
  try {
    chatRequest = await readChatRequest(request);
  } catch (error) {
    if (error instanceof ChatAttachmentRequestError)
      return Response.json(
        { error: error.code, message: error.message },
        { status: error.status },
      );
    return Response.json(
      { error: "VALIDATION_ERROR", message: "The chat request is invalid." },
      { status: 400 },
    );
  }
  const parsed = chatRequestSchema.safeParse(chatRequest.payload);
  if (!parsed.success)
    return Response.json(
      { error: "VALIDATION_ERROR", message: "Enter a valid message." },
      { status: 400 },
    );
  try {
    return chatStreamResponse((onToken) =>
      sendKnowledgeChatMessage(context, {
        ...parsed.data,
        attachments: chatRequest.attachments,
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
