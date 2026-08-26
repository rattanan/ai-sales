import { universalChatRequestSchema } from "@/schemas/knowledge";
import { getAuthorizationContext } from "@/server/auth/authorization";
import { chatStreamResponse } from "@/server/http/chat-stream-response";
import { readChatRequest } from "@/server/http/chat-request";
import { sendUniversalChatMessage } from "@/server/services/chat-service";
import { ChatAttachmentRequestError } from "@/server/services/chat-attachment-service";

// An agentic turn can run several tool steps before the model answers. The
// deployment proxy allows 300s (docker/proxy_params); the loop's own wall-clock
// budget in agentic-chat-service stops well inside this ceiling.
export const maxDuration = 120;

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
  const parsed = universalChatRequestSchema.safeParse(chatRequest.payload);
  if (!parsed.success)
    return Response.json(
      {
        error: "VALIDATION_ERROR",
        message: "Check the chat scope and message.",
      },
      { status: 422 },
    );
  try {
    return chatStreamResponse((onToken, onStepEvent, onArtifact) =>
      sendUniversalChatMessage(context, {
        ...parsed.data,
        attachments: chatRequest.attachments,
        onToken,
        onStepEvent,
        onArtifact,
      }),
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
