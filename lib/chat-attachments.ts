export const CHAT_ATTACHMENT_ACCEPT =
  ".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm";
export const CHAT_ATTACHMENT_MAX_FILES = 3;
export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export type ChatAttachmentSummary = {
  name: string;
  size: number;
};

export function chatAttachmentNames(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const attachments = (value as { attachments?: unknown }).attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((attachment) => {
    if (
      !attachment ||
      typeof attachment !== "object" ||
      Array.isArray(attachment) ||
      typeof (attachment as { name?: unknown }).name !== "string"
    )
      return [];
    return [(attachment as { name: string }).name];
  });
}

export function formatAttachmentSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
