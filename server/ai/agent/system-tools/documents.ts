import { z } from "zod";
import { db } from "@/server/db";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { retrieveBotContext } from "@/server/services/retrieval-service";
import {
  defineAgentTool,
  toolSuccess,
  type AgentRunContext,
} from "@/server/ai/agent/types";

async function botIsUsable(context: AgentRunContext) {
  try {
    await requireBotUse(context.authorization, context.botId);
    return true;
  } catch {
    return false;
  }
}

export const searchDocuments = defineAgentTool({
  name: "search_documents",
  kind: "SYSTEM",
  access: "READ",
  group: "DOCUMENT",
  description:
    "ค้นหาเอกสารในคลังความรู้ขององค์กรที่ผู้ใช้มีสิทธิ์เข้าถึง (ไฟล์ PDF / Word / Excel / เว็บเพจ ที่อัปโหลดและ index ไว้แล้ว) " +
    "ใช้กับคำถามเชิงนโยบาย ขั้นตอนปฏิบัติ คู่มือ สัญญา หรือเนื้อหาที่เขียนไว้ในเอกสาร " +
    "ไม่ใช่ข้อมูลสดหรือตัวเลขปัจจุบันในฐานข้อมูล (กรณีนั้นให้ใช้ query_database) " +
    "และไม่ใช่บทสนทนาเก่าของผู้ใช้ (กรณีนั้นให้ใช้ search_conversation_history) " +
    "เรียก list_document_sources ก่อนได้ถ้าต้องการรู้ว่ามีคลังเอกสารใดบ้าง",
  parameters: z.object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(500)
      .describe("คำค้นหรือหัวข้อที่ต้องการค้นในเอกสาร ใช้ภาษาเดียวกับผู้ใช้"),
    sourceIds: z
      .array(z.string().min(1))
      .max(20)
      .optional()
      .describe(
        "จำกัดการค้นเฉพาะแหล่งข้อมูลที่ระบุ (id จาก list_document_sources) ไม่ระบุ = ค้นทุกแหล่งที่มีสิทธิ์",
      ),
  }),
  authorize: botIsUsable,
  async execute(context, args) {
    // A request that pinned sources may only be narrowed by the model, never
    // widened: the pin is the user's scope choice, the argument is a hint.
    const pinnedSources = context.retrieval.sourceIds;
    const pinnedDocuments = context.retrieval.documentIds;
    const evidence = await retrieveBotContext(
      context.authorization,
      context.botId,
      args.query,
      {
        allAccessible: context.retrieval.allAccessible,
        sourceIds: pinnedSources.length ? pinnedSources : args.sourceIds,
        documentIds: pinnedDocuments.length ? pinnedDocuments : undefined,
      },
    );
    if (!evidence.length)
      // An empty result is not a failure: it is the answer "no such document",
      // and the knowledge-gap report depends on it being recorded as such.
      return toolSuccess(
        "ไม่พบเอกสารที่ตรงกับคำค้นนี้ในคลังความรู้ที่ผู้ใช้มีสิทธิ์เข้าถึง ลองปรับคำค้นให้ตรงกับคำที่น่าจะปรากฏในเอกสาร",
      );
    const names = [
      ...new Set(evidence.map((item) => item.documentName)),
    ].join(", ");
    return toolSuccess(
      `พบเนื้อหาที่เกี่ยวข้อง ${evidence.length} ส่วน จากเอกสาร: ${names}`,
      evidence,
    );
  },
});

export const listDocumentSources = defineAgentTool({
  name: "list_document_sources",
  kind: "SYSTEM",
  access: "READ",
  group: "DOCUMENT",
  description:
    "แสดงรายชื่อคลังเอกสารและแหล่งข้อมูลทั้งหมดที่ผู้ใช้มีสิทธิ์เข้าถึงในบอตนี้ พร้อม id สำหรับส่งต่อให้ search_documents " +
    "ใช้เมื่อผู้ใช้ถามว่ามีเอกสารอะไรบ้าง หรือเมื่อต้องการจำกัดขอบเขตการค้นก่อนเรียก search_documents " +
    "เครื่องมือนี้ไม่ค้นเนื้อหาในเอกสาร",
  parameters: z.object({}),
  authorize: botIsUsable,
  async execute(context) {
    const racks = await db.knowledgeRack.findMany({
      where: {
        organizationId: context.authorization.organizationId,
        active: true,
        ...(context.retrieval.allAccessible
          ? {}
          : {
              OR: [
                { scope: "GLOBAL" as const },
                { bots: { some: { botId: context.botId } } },
                {
                  sources: {
                    some: {
                      active: true,
                      OR: [
                        { scope: "GLOBAL" as const },
                        {
                          botAssignments: {
                            some: { botId: context.botId, enabled: true },
                          },
                        },
                      ],
                    },
                  },
                },
              ],
            }),
      },
      select: {
        id: true,
        name: true,
        description: true,
        sources: {
          where: { active: true, status: "READY" },
          select: { id: true, name: true, description: true, category: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    });
    const visible = [] as Array<(typeof racks)[number]>;
    for (const rack of racks) {
      const decision = await authorizeResource(
        context.authorization,
        "KNOWLEDGE_RACK",
        rack.id,
        "VIEW",
      );
      if (decision.allowed) visible.push(rack);
    }
    if (!visible.length)
      return toolSuccess(
        "ผู้ใช้ยังไม่มีสิทธิ์เข้าถึงคลังเอกสารใดในบอตนี้ กรุณาแจ้งผู้ดูแลให้กำหนดสิทธิ์",
      );
    const catalog = visible.map((rack) => ({
      rack: rack.name,
      description: rack.description ?? undefined,
      sources: rack.sources.map((source) => ({
        id: source.id,
        name: source.name,
        category: source.category ?? undefined,
        description: source.description ?? undefined,
      })),
    }));
    return toolSuccess(JSON.stringify(catalog));
  },
});
