import { describe, expect, it } from "vitest";
import { classifyDatabaseChatIntent } from "@/server/services/database-chat-intent";

describe("classifyDatabaseChatIntent", () => {
  it("queries for explicit database questions", () => {
    expect(classifyDatabaseChatIntent("ดึงข้อมูลรายการล่าสุดให้หน่อย")).toBe(
      "QUERY",
    );
    expect(classifyDatabaseChatIntent("How many orders are there?")).toBe(
      "QUERY",
    );
    expect(
      classifyDatabaseChatIntent(
        "ช่วยหา asset ที่มี description เกี่ยวกับ filter",
      ),
    ).toBe("QUERY");
    expect(classifyDatabaseChatIntent("Find assets containing filter")).toBe(
      "QUERY",
    );
  });

  it("asks before querying when database intent is ambiguous", () => {
    expect(classifyDatabaseChatIntent("สถานะล่าสุดเป็นอย่างไร")).toBe(
      "CONFIRM",
    );
    expect(classifyDatabaseChatIntent("Tell me about this report")).toBe(
      "CONFIRM",
    );
  });

  it("does not intercept ordinary knowledge questions", () => {
    expect(classifyDatabaseChatIntent("สรุปนโยบายวันลาให้หน่อย")).toBe("NONE");
  });

  it("honors an explicit live-query scope", () => {
    expect(classifyDatabaseChatIntent("ช่วยตอบคำถามนี้", true)).toBe("QUERY");
  });
});
