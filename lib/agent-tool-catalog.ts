/**
 * The tool catalog as the configuration UI needs to see it: names, labels and
 * groups, with no server-only imports so a Client Component can render it.
 *
 * Kept in step with `server/ai/agent/tool-registry.ts` by a test that compares
 * the two lists — a tool added to the registry but missing here would silently
 * become unmanageable from the UI.
 */
export type AgentToolGroupKey =
  | "DOCUMENT"
  | "HISTORY"
  | "INSIGHT"
  | "DATABASE"
  | "WEB"
  | "DISPLAY"
  | "PLATFORM";

export type AgentToolCatalogEntry = {
  name: string;
  label: string;
  description: string;
  group: AgentToolGroupKey;
};

export const AGENT_TOOL_GROUP_LABEL: Record<AgentToolGroupKey, string> = {
  DOCUMENT: "เอกสารและคลังความรู้",
  HISTORY: "บทสนทนาเก่า",
  INSIGHT: "ผลวิเคราะห์ธุรกิจ",
  DATABASE: "ฐานข้อมูล",
  WEB: "อินเทอร์เน็ต",
  DISPLAY: "การแสดงผล",
  PLATFORM: "ข้อมูลระบบ",
};

export const AGENT_TOOL_CATALOG: AgentToolCatalogEntry[] = [
  {
    name: "search_documents",
    label: "ค้นเอกสาร",
    description: "ค้นเนื้อหาในคลังความรู้ที่ผู้ใช้มีสิทธิ์เข้าถึง",
    group: "DOCUMENT",
  },
  {
    name: "list_document_sources",
    label: "ดูรายการคลังเอกสาร",
    description: "แสดงคลังและแหล่งข้อมูลที่ใช้ได้ ก่อนเลือกค้น",
    group: "DOCUMENT",
  },
  {
    name: "search_knowledge",
    label: "ค้นฐานความรู้รวม",
    description:
      "รวมการค้นทุกแหล่งเป็นเครื่องมือเดียว ใช้เมื่อตั้งโหมดเครื่องมือเป็น COMBINED",
    group: "DOCUMENT",
  },
  {
    name: "search_conversation_history",
    label: "ค้นบทสนทนาเก่า",
    description: "ค้นข้อความที่ผู้ใช้คนนี้เคยคุยไว้",
    group: "HISTORY",
  },
  {
    name: "search_business_insights",
    label: "ค้นผลวิเคราะห์ธุรกิจ",
    description: "ค้นผล Business Insight ที่ระบบประมวลผลไว้แล้ว",
    group: "INSIGHT",
  },
  {
    name: "list_data_sources",
    label: "ดูรายการฐานข้อมูล",
    description: "แสดงฐานข้อมูลที่เชื่อมต่อและมีสิทธิ์ใช้",
    group: "DATABASE",
  },
  {
    name: "query_database",
    label: "ดึงข้อมูลจากฐานข้อมูล",
    description: "สร้างคำสั่งอ่านอย่างเดียวจากคำถามภาษาธรรมชาติ",
    group: "DATABASE",
  },
  {
    name: "web_search",
    label: "ค้นเว็บ",
    description: "ค้นข้อมูลสาธารณะจากอินเทอร์เน็ต",
    group: "WEB",
  },
  {
    name: "display_qr",
    label: "แสดง QR Code",
    description: "สร้าง QR จาก payload ที่มีหลักฐานอยู่ในบทสนทนา",
    group: "DISPLAY",
  },
  {
    name: "display_chart",
    label: "แสดงกราฟ",
    description: "แสดง bar, line, pie หรือ doughnut จากตัวเลขที่มีหลักฐาน",
    group: "DISPLAY",
  },
  {
    name: "display_image",
    label: "แสดงรูปภาพ",
    description: "ดาวน์โหลดและตรวจรูปจาก HTTPS URL ก่อนแสดงในแชท",
    group: "DISPLAY",
  },
  {
    name: "get_current_datetime",
    label: "ตรวจวันที่ปัจจุบัน",
    description: "อ่านวันเวลาจริงตอนเรียก แทนการเดาจากความจำของโมเดล",
    group: "PLATFORM",
  },
];

export const AGENT_TOOL_GROUP_ORDER: AgentToolGroupKey[] = [
  "DOCUMENT",
  "HISTORY",
  "INSIGHT",
  "DATABASE",
  "WEB",
  "DISPLAY",
  "PLATFORM",
];

/** Visible-media tools are opt-in because they add persisted chat artifacts. */
export const DEFAULT_DISABLED_AGENT_TOOLS = [
  "display_qr",
  "display_chart",
  "display_image",
] as const;
