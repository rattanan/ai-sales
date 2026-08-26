import { z } from "zod";
import { searchWeb } from "@/server/services/web-search";
import { maskFreeText } from "@/server/services/sensitive-data";
import {
  defineAgentTool,
  toolFailure,
  toolSuccess,
} from "@/server/ai/agent/types";

export const webSearch = defineAgentTool({
  name: "web_search",
  kind: "SYSTEM",
  access: "READ",
  group: "WEB",
  description:
    "ค้นหาข้อมูลสาธารณะจากอินเทอร์เน็ต ใช้เมื่อคำถามต้องการข้อมูลภายนอกองค์กร เช่น ข่าว ราคาตลาด ข้อมูลบริษัทคู่ค้า หรือข้อมูลอ้างอิงทั่วไป " +
    "ไม่ใช่เอกสารภายในองค์กร (กรณีนั้นให้ใช้ search_documents) และไม่ใช่ข้อมูลลูกค้าในระบบ (กรณีนั้นให้ใช้ ntop_search) " +
    "คำค้นจะถูกปกปิดข้อมูลส่วนบุคคลก่อนส่งออกภายนอก",
  parameters: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(300)
      .describe("คำค้นสำหรับเสิร์ชเอนจิน ห้ามใส่ข้อมูลลับหรือข้อมูลส่วนบุคคลของลูกค้า"),
  }),
  async execute(context, args) {
    // The query leaves the tenant boundary, so it is masked here rather than
    // relying on the model to have kept personal data out of it.
    const query = maskFreeText(args.query, context.privacyPolicy);
    let evidence;
    try {
      evidence = await searchWeb(query);
    } catch (error) {
      const notConfigured =
        error instanceof Error && error.message === "WEB_SEARCH_NOT_CONFIGURED";
      return toolFailure(
        notConfigured
          ? "ยังไม่ได้ตั้งค่า Web Search สำหรับระบบนี้ ให้แจ้งผู้ใช้ว่าค้นเว็บไม่ได้ อย่าเดาคำตอบจากความจำ"
          : "ค้นเว็บไม่สำเร็จในขณะนี้ ให้แจ้งผู้ใช้แทนการเดาคำตอบ",
        notConfigured ? "WEB_SEARCH_NOT_CONFIGURED" : "WEB_SEARCH_ERROR",
      );
    }
    if (!evidence.length)
      return toolSuccess("ไม่พบผลลัพธ์จากการค้นเว็บสำหรับคำค้นนี้ ลองปรับคำค้น");
    return toolSuccess(
      `พบผลการค้นเว็บ ${evidence.length} รายการ`,
      evidence,
    );
  },
});
