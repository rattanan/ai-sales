import { describe, expect, it } from "vitest";

import { attachmentContentDisposition } from "@/server/http/content-disposition";

describe("attachmentContentDisposition", () => {
  it("uses an ASCII fallback and UTF-8 filename for Thai downloads", () => {
    const value = attachmentContentDisposition(
      "สรุปการสนทนา.md",
      "conversation.md",
    );

    expect(value).toBe(
      `attachment; filename="conversation.md"; filename*=UTF-8''${encodeURIComponent("สรุปการสนทนา.md")}`,
    );
    expect(
      () =>
        new Response("markdown", { headers: { "content-disposition": value } }),
    ).not.toThrow();
  });

  it("keeps an ASCII filename for legacy clients", () => {
    expect(attachmentContentDisposition("weekly-summary.md")).toBe(
      "attachment; filename=\"weekly-summary.md\"; filename*=UTF-8''weekly-summary.md",
    );
  });

  it("encodes RFC 5987 special characters", () => {
    expect(attachmentContentDisposition("team's (draft).md")).toContain(
      "filename*=UTF-8''team%27s%20%28draft%29.md",
    );
  });
});
