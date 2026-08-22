import { describe, expect, it } from "vitest";
import { chatAttachmentNames } from "@/lib/chat-attachments";
import { readChatRequest } from "@/server/http/chat-request";
import {
  ChatAttachmentRequestError,
  parseChatAttachments,
} from "@/server/services/chat-attachment-service";

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
