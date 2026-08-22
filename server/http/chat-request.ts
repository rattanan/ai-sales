import { CHAT_ATTACHMENT_MAX_TOTAL_BYTES } from "@/lib/chat-attachments";
import {
  ChatAttachmentRequestError,
  parseChatAttachments,
  type ParsedChatAttachment,
} from "@/server/services/chat-attachment-service";
import { contentLengthWithinLimit } from "@/server/http/request-security";

const MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export async function readChatRequest(request: Request): Promise<{
  payload: unknown;
  attachments: ParsedChatAttachment[];
}> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("multipart/form-data"))
    return {
      payload: await request.json().catch(() => null),
      attachments: [],
    };

  if (
    !contentLengthWithinLimit(
      request,
      CHAT_ATTACHMENT_MAX_TOTAL_BYTES + MULTIPART_OVERHEAD_BYTES,
    )
  )
    throw new ChatAttachmentRequestError(
      "Attachments exceed the request size limit.",
      413,
      "FILE_TOO_LARGE",
    );

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    throw new ChatAttachmentRequestError("The attachment upload is invalid.");
  }
  const serializedPayload = formData.get("payload");
  if (typeof serializedPayload !== "string")
    throw new ChatAttachmentRequestError("The chat request is invalid.");

  let payload: unknown;
  try {
    payload = JSON.parse(serializedPayload);
  } catch {
    throw new ChatAttachmentRequestError("The chat request is invalid.");
  }
  const files = formData
    .getAll("attachments")
    .filter((item): item is File => item instanceof File);
  return { payload, attachments: await parseChatAttachments(files) };
}
