import { describe, expect, it } from "vitest";
import { formatApiAnswer } from "@/server/services/api-answer-formatter";

describe("formatApiAnswer", () => {
  it("formats an API object as readable fields instead of JSON", () => {
    const result = formatApiAnswer("อากาศวันนี้เป็นอย่างไร", "Weather API", {
      name: "Bangkok",
      main: { temp: 31.5, humidity: 68 },
      weather: [{ description: "เมฆบางส่วน" }],
    });

    expect(result.summary).toContain("ข้อมูลจาก Weather API");
    expect(result.summary).toContain("- สภาพอากาศ: เมฆบางส่วน");
    expect(result.summary).toContain("- อุณหภูมิ: 31.5");
    expect(result.summary).toContain("- ความชื้น: 68");
    expect(result.summary).not.toMatch(/[{}\[\]"]/);
  });

  it("formats an array of objects as a table limited to ten rows", () => {
    const payload = Array.from({ length: 12 }, (_, index) => ({
      id: index + 1,
      name: `Item ${index + 1}`,
    }));

    const result = formatApiAnswer("แสดงรายการ", "Asset API", payload);

    expect(result.summary).toContain("| Id | Name |");
    expect(result.summary).toContain("| 10 | Item 10 |");
    expect(result.summary).not.toContain("Item 11");
    expect(result.limitations).toEqual(["แสดง 10 จากทั้งหมด 12 รายการ"]);
  });

  it("formats primitive API values as a sentence", () => {
    expect(
      formatApiAnswer("ขอสถานะ", "Status API", "พร้อมใช้งาน").summary,
    ).toBe("ข้อมูลจาก Status API: พร้อมใช้งาน");
  });
});
