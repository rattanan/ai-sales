import { describe, expect, it } from "vitest";
import { chatAttachmentNames } from "@/lib/chat-attachments";
import { readChatRequest } from "@/server/http/chat-request";
import {
  ChatAttachmentRequestError,
  parseChatAttachments,
} from "@/server/services/chat-attachment-service";

function imageOnlyPdf() {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R >>\nendobj\n",
    "4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(body));
    body += object;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  body += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(body);
}

describe("chat attachments", () => {
  it("reads and parses supported multipart chat files", async () => {
    const formData = new FormData();
    formData.set(
      "payload",
      JSON.stringify({ message: "Summarize this", scope: "SMART" }),
    );
    formData.append(
      "attachments",
      new File(["Quarterly revenue increased by 12%."], "report.txt", {
        type: "text/plain",
      }),
    );

    const result = await readChatRequest(
      new Request("http://localhost/api/universal-chat", {
        method: "POST",
        body: formData,
      }),
    );

    expect(result.payload).toEqual({
      message: "Summarize this",
      scope: "SMART",
    });
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toMatchObject({
      name: "report.txt",
      mimeType: "text/plain",
      size: 35,
    });
    expect(result.attachments[0].sections[0].text).toContain(
      "revenue increased",
    );
  });

  it("rejects unsupported types and mismatched signatures", async () => {
    await expect(
      parseChatAttachments([
        new File(["not allowed"], "payload.exe", {
          type: "application/octet-stream",
        }),
      ]),
    ).rejects.toBeInstanceOf(ChatAttachmentRequestError);

    await expect(
      parseChatAttachments([
        new File(["not a pdf"], "report.pdf", { type: "application/pdf" }),
      ]),
    ).rejects.toThrow(/signature/i);
  });

  it("renders scanned PDFs as page images for a vision-capable model", async () => {
    const [attachment] = await parseChatAttachments([
      new File([imageOnlyPdf()], "เอกสารสแกน.pdf", {
        type: "application/pdf",
      }),
    ]);

    expect(attachment.sections).toEqual([]);
    expect(attachment.totalPages).toBe(1);
    expect(attachment.visualPages).toHaveLength(1);
    expect(attachment.visualPages?.[0]).toMatchObject({ page: 1 });
    expect(attachment.visualPages?.[0].dataUrl).toMatch(
      /^data:image\/png;base64,/,
    );
  });

  it("restores attachment names from persisted message metadata", () => {
    expect(
      chatAttachmentNames({
        attachments: [
          { name: "policy.pdf", size: 123 },
          { name: "sales.xlsx", size: 456 },
          { invalid: true },
        ],
      }),
    ).toEqual(["policy.pdf", "sales.xlsx"]);
    expect(chatAttachmentNames(null)).toEqual([]);
  });
});
