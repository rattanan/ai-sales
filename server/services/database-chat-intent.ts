export type DatabaseChatIntent = "QUERY" | "CONFIRM" | "NONE";

const strongDatabaseIntent =
  /\b(count|total|sum|average|avg|maximum|minimum|trend|revenue|sales|orders?|customers?|rows?|records?|how many|query|fetch|find|search|look up|show me|list)\b|จำนวน|ยอด|รวม|เฉลี่ย|สูงสุด|ต่ำสุด|แนวโน้ม|รายได้|คำสั่งซื้อ|ลูกค้า|ดึงข้อมูล|ค้นข้อมูล|แสดงรายการ|ดูยอด|เช็กสถานะ/iu;

const technicalEntitySearchIntent =
  /(?:ช่วย\s*)?(?:หา|ค้นหา)(?=[^\n]*\b[A-Za-z][A-Za-z0-9_-]*\b)/iu;

const possibleDatabaseIntent =
  /\b(data|database|table|record|status|latest|report)\b|ข้อมูล|ฐานข้อมูล|ตาราง|รายการ|สถานะ|ล่าสุด|รายงาน/iu;

export function classifyDatabaseChatIntent(
  question: string,
  forceQuery = false,
): DatabaseChatIntent {
  if (forceQuery) return "QUERY";
  if (
    strongDatabaseIntent.test(question) ||
    technicalEntitySearchIntent.test(question)
  )
    return "QUERY";
  if (possibleDatabaseIntent.test(question)) return "CONFIRM";
  return "NONE";
}
