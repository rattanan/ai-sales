import { describe, expect, it } from "vitest";
import { formatDatabaseAnswer } from "@/server/services/database-answer-formatter";

describe("formatDatabaseAnswer", () => {
  it("formats a Thai Work Order count as a concise sentence", () => {
    const result = formatDatabaseAnswer(
      "ขอจำนวน Work Order ที่มีในระบบ",
      [{ total_work_orders: 2747 }],
      1,
    );

    expect(result.summary).toBe("พบ Work Order จำนวน 2,747 รายการ");
    expect(result.summary).not.toMatch(/[{}\[\]]/);
    expect(result.limitations).toEqual([]);
  });

  it("formats an Asset count without exposing JSON", () => {
    const result = formatDatabaseAnswer(
      "ขอจำนวน Asset ที่มีทั้งหมดในระบบ",
      [{ total_assets: 6287 }],
      1,
    );

    expect(result.summary).toBe("พบ Asset จำนวน 6,287 รายการ");
  });

  it("formats multiple records as a Markdown table with a preview note", () => {
    const result = formatDatabaseAnswer(
      "ช่วยหา asset ที่มี description เกี่ยวกับ filter",
      [
        { code: "A-01", name: "Filter pump" },
        { code: "A-02", name: "Oil filter" },
      ],
      119,
    );

    expect(result.summary).toContain("| Code | Name |");
    expect(result.summary).toContain("| A-01 | Filter pump |");
    expect(result.summary).not.toMatch(/[{}\[\]]/);
    expect(result.limitations).toEqual([
      "แสดงตัวอย่าง 2 จากทั้งหมด 119 รายการ",
    ]);
  });

  it("limits long database results to ten readable rows", () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      code: `A-${index + 1}`,
    }));

    const result = formatDatabaseAnswer("แสดงรายการ asset", rows, 25);

    expect(result.summary).toContain("| A-10 |");
    expect(result.summary).not.toContain("| A-11 |");
    expect(result.limitations).toEqual([
      "แสดงตัวอย่าง 10 จากทั้งหมด 25 รายการ",
    ]);
  });
});
