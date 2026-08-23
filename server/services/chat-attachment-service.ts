import { createHash } from "node:crypto";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
} from "@/lib/chat-attachments";
import { parseDocument } from "@/packages/knowledge/document-parser";
import {
  validKnowledgeUploadIdentity,
  validKnowledgeUploadMagic,
} from "@/packages/knowledge/upload-validation";
import { env } from "@/schemas/env";

const MAX_EXTRACTED_CHARACTERS_PER_FILE = 200_000;
const MAX_SCANNED_PDF_PAGES = 6;
const MAX_RENDERED_IMAGE_CHARACTERS = 12 * 1024 * 1024;

export type ChatAttachmentVisualPage = {
  page: number;
  dataUrl: string;
};

export type ParsedChatAttachment = {
  name: string;
  mimeType: string;
  size: number;
  checksum: string;
  sections: Array<{
    text: string;
    metadata: Record<string, string | number>;
  }>;
  visualPages?: ChatAttachmentVisualPage[];
  totalPages?: number;
};

export class ChatAttachmentRequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "FILE_INVALID",
  ) {
    super(message);
    this.name = "ChatAttachmentRequestError";
  }
}

function boundedSections(
  sections: ParsedChatAttachment["sections"],
): ParsedChatAttachment["sections"] {
  const bounded: ParsedChatAttachment["sections"] = [];
  let remaining = MAX_EXTRACTED_CHARACTERS_PER_FILE;
  for (const section of sections) {
    if (remaining <= 0) break;
    const text = section.text.slice(0, remaining);
    if (text) bounded.push({ text, metadata: section.metadata });
    remaining -= text.length;
  }
  return bounded;
}

async function renderScannedPdf(bytes: Buffer) {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: bytes });
  try {
    const screenshots = await parser.getScreenshot({
      first: MAX_SCANNED_PDF_PAGES,
      desiredWidth: 1_400,
      imageBuffer: false,
      imageDataUrl: true,
    });
    const visualPages: ChatAttachmentVisualPage[] = [];
    let characters = 0;
    for (const page of screenshots.pages) {
      if (!page.dataUrl) continue;
      if (
        visualPages.length > 0 &&
        characters + page.dataUrl.length > MAX_RENDERED_IMAGE_CHARACTERS
      )
        break;
      visualPages.push({ page: page.pageNumber, dataUrl: page.dataUrl });
      characters += page.dataUrl.length;
    }
    return { visualPages, totalPages: screenshots.total };
  } finally {
    await parser.destroy();
  }
}

export async function parseChatAttachments(files: File[]) {
  if (files.length > CHAT_ATTACHMENT_MAX_FILES)
    throw new ChatAttachmentRequestError(
      `Attach up to ${CHAT_ATTACHMENT_MAX_FILES} files per message.`,
    );

  const maximumFileBytes = Math.min(
    CHAT_ATTACHMENT_MAX_BYTES,
    env().KNOWLEDGE_MAX_UPLOAD_BYTES,
  );
  const totalBytes = files.reduce((total, file) => total + file.size, 0);
  if (totalBytes > CHAT_ATTACHMENT_MAX_TOTAL_BYTES)
    throw new ChatAttachmentRequestError(
      "Attachments exceed the 20 MB total size limit.",
      413,
      "FILE_TOO_LARGE",
    );

  return Promise.all(
    files.map(async (file): Promise<ParsedChatAttachment> => {
      if (
        !file.name ||
        !validKnowledgeUploadIdentity(file.name, file.type) ||
        file.size < 1 ||
        file.size > maximumFileBytes
      )
        throw new ChatAttachmentRequestError(
          "Attach a supported PDF, DOCX, XLSX, CSV, TXT, Markdown, or HTML file up to 10 MB.",
          file.size > maximumFileBytes ? 413 : 400,
          file.size > maximumFileBytes ? "FILE_TOO_LARGE" : "FILE_INVALID",
        );

      const bytes = Buffer.from(await file.arrayBuffer());
      if (!validKnowledgeUploadMagic(bytes, file.name))
        throw new ChatAttachmentRequestError(
          `The file signature for ${file.name} does not match its type.`,
        );

      let parsed: Awaited<ReturnType<typeof parseDocument>> | undefined;
      let visualPages: ChatAttachmentVisualPage[] | undefined;
      let totalPages: number | undefined;
      try {
        parsed = await parseDocument(bytes, file.name);
      } catch {
        if (file.name.toLocaleLowerCase().endsWith(".pdf"))
          try {
            const rendered = await renderScannedPdf(bytes);
            visualPages = rendered.visualPages;
            totalPages = rendered.totalPages;
          } catch {
            // The common validation error below intentionally does not expose
            // PDF parser or renderer internals to the client.
          }
        if (!visualPages?.length)
          throw new ChatAttachmentRequestError(
            `No readable text or pages could be extracted from ${file.name}.`,
          );
      }
      return {
        name: file.name,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        sections: parsed ? boundedSections(parsed.sections) : [],
        visualPages,
        totalPages,
      };
    }),
  );
}
