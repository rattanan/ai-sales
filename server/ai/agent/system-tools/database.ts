import { z } from "zod";
import { db } from "@/server/db";
import { authorizeResource } from "@/server/auth/resource-authorization";
import {
  executeDatabaseQuery,
  proposeDatabaseQuery,
} from "@/server/services/database-intelligence-service";
import {
  defineAgentTool,
  toolFailure,
  toolSuccess,
  type AgentRunContext,
  type GroundingEvidence,
} from "@/server/ai/agent/types";

type AccessibleDataSource = {
  id: string;
  name: string;
  type: string;
  /** Only an assignment row lets `proposeDatabaseQuery` accept a botId. */
  assignedToBot: boolean;
};

/**
 * The set of databases this turn may reach: the bot's own assignments plus the
 * workspace-visible ones, each still cleared through the resource ACL.
 */
export async function accessibleDataSources(
  context: AgentRunContext,
): Promise<AccessibleDataSource[]> {
  const [assigned, shared] = await Promise.all([
    db.botDataSource.findMany({
      where: {
        botId: context.botId,
        enabled: true,
        bot: {
          organizationId: context.authorization.organizationId,
          active: true,
          databaseToolsEnabled: true,
        },
      },
      include: { dataSource: { select: { id: true, name: true, type: true } } },
      orderBy: { priority: "asc" },
    }),
    db.dataSource.findMany({
      where: {
        workspaceId: context.authorization.workspaceId,
        sourceStatus: { not: "DISABLED" },
        status: "CONNECTED",
        type: { in: ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] },
        bots: { none: { botId: context.botId } },
        schemas: { some: { tables: { some: { selected: true } } } },
        ...(context.isUniversal ? {} : { sourceScope: "GLOBAL" as const }),
      },
      select: { id: true, name: true, type: true },
      orderBy: { name: "asc" },
    }),
  ]);
  const candidates: AccessibleDataSource[] = [
    ...assigned.map(({ dataSource }) => ({
      id: dataSource.id,
      name: dataSource.name,
      type: String(dataSource.type),
      assignedToBot: true,
    })),
    ...shared.map((source) => ({
      id: source.id,
      name: source.name,
      type: String(source.type),
      assignedToBot: false,
    })),
  ];
  const allowed: AccessibleDataSource[] = [];
  for (const source of candidates) {
    if (allowed.some((item) => item.id === source.id)) continue;
    const decision = await authorizeResource(
      context.authorization,
      "DATA_SOURCE",
      source.id,
      "USE",
    );
    if (decision.allowed) allowed.push(source);
  }
  return allowed;
}

export const listDataSources = defineAgentTool({
  name: "list_data_sources",
  kind: "SYSTEM",
  access: "READ",
  group: "DATABASE",
  description:
    "แสดงรายชื่อฐานข้อมูลที่บอตนี้เชื่อมต่อและผู้ใช้มีสิทธิ์ใช้งาน พร้อม id สำหรับส่งต่อให้ query_database " +
    "เรียกเครื่องมือนี้ก่อน query_database เสมอเมื่อยังไม่รู้ว่ามีฐานข้อมูลใดบ้าง " +
    "เครื่องมือนี้ไม่ดึงข้อมูลในตาราง",
  parameters: z.object({}),
  async execute(context) {
    const sources = await accessibleDataSources(context);
    if (!sources.length)
      return toolSuccess(
        "บอตนี้ยังไม่มีฐานข้อมูลที่ผู้ใช้มีสิทธิ์ใช้งาน หากคำถามต้องใช้ข้อมูลสด ให้แจ้งผู้ใช้ว่ายังไม่ได้เชื่อมต่อฐานข้อมูล",
      );
    return toolSuccess(
      JSON.stringify(
        sources.map(({ id, name, type }) => ({ id, name, type })),
      ),
    );
  },
});

export const queryDatabase = defineAgentTool({
  name: "query_database",
  kind: "SYSTEM",
  access: "READ",
  group: "DATABASE",
  // executeDatabaseQuery masks every cell through sanitizeSampleRow.
  selfMasked: true,
  description:
    "ถามคำถามกับฐานข้อมูลที่เชื่อมต่อไว้เพื่อดึงตัวเลขหรือสถานะปัจจุบัน เช่น ยอดขาย จำนวนรายการ สถานะล่าสุด แนวโน้มตามช่วงเวลา " +
    "ระบบจะสร้างคำสั่งอ่านอย่างเดียวให้เอง จึงต้องส่งคำถามเป็นภาษาธรรมชาติ ไม่ใช่ SQL " +
    "ระบุช่วงเวลา ตัวชี้วัด และเงื่อนไขให้ชัดเจนเพื่อให้สร้างคำสั่งได้ " +
    "ถ้าคำตอบอยู่ในเอกสารนโยบายหรือคู่มือ ให้ใช้ search_documents แทน",
  parameters: z.object({
    dataSourceId: z
      .string()
      .min(1)
      .describe("id ของฐานข้อมูลจาก list_data_sources"),
    question: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .describe(
        "คำถามภาษาธรรมชาติที่ระบุตัวชี้วัด ช่วงเวลา และเงื่อนไขให้ชัดเจน",
      ),
  }),
  async authorize(context, args) {
    const sources = await accessibleDataSources(context);
    return sources.some((source) => source.id === args.dataSourceId);
  },
  async execute(context, args) {
    const sources = await accessibleDataSources(context);
    const source = sources.find((item) => item.id === args.dataSourceId);
    if (!source)
      return toolFailure(
        "ไม่พบฐานข้อมูลนี้ หรือผู้ใช้ไม่มีสิทธิ์ใช้งาน เรียก list_data_sources เพื่อดูรายการที่ใช้ได้",
        "DATA_SOURCE_NOT_ACCESSIBLE",
      );
    const proposal = await proposeDatabaseQuery(context.authorization, {
      dataSourceId: source.id,
      question: args.question,
      // Only an assigned source has the BotDataSource row this check requires.
      ...(source.assignedToBot ? { botId: context.botId } : {}),
    });
    if (!proposal.ok)
      return toolFailure(
        "สร้างคำสั่งอ่านข้อมูลที่ปลอดภัยจากคำถามนี้ไม่ได้ ลองระบุตัวชี้วัด ช่วงเวลา และเงื่อนไขให้เจาะจงขึ้นแล้วเรียกใหม่",
        "DATABASE_QUERY_ERROR",
      );
    if (proposal.data.status === "CLARIFICATION_REQUIRED")
      return toolSuccess(
        "clarification" in proposal.data && proposal.data.clarification
          ? `ต้องการข้อมูลเพิ่มก่อนดึงข้อมูลได้: ${proposal.data.clarification}`
          : "คำถามยังไม่เจาะจงพอที่จะสร้างคำสั่งอ่านข้อมูลได้",
      );
    const execution = await executeDatabaseQuery(
      context.authorization,
      proposal.data.id,
    );
    if (!execution.ok)
      return toolFailure(
        "คำสั่งผ่านการตรวจสอบแล้วแต่ฐานข้อมูลประมวลผลไม่สำเร็จในขณะนี้",
        "DATABASE_QUERY_ERROR",
      );
    const summary = [
      execution.data.summary,
      ...execution.data.limitations.map((item) => `• ${item}`),
    ].join("\n");
    const evidence: GroundingEvidence[] = [
      {
        content: summary,
        contentHash: execution.data.id,
        metadata: { sourceType: "DATABASE", dataSourceId: source.id },
        documentId: execution.data.id,
        sourceId: source.id,
        documentName: `Database: ${source.name}`,
        mimeType: "application/vnd.insightkm.database-result",
        vectorScore: 0,
        keywordScore: 1,
        score: 1,
      },
    ];
    return toolSuccess(summary, evidence, {
      citation: {
        kind: "DATABASE_QUERY",
        id: execution.data.id,
        quote: summary.slice(0, 500),
        metadata: (execution.data.citation ?? {}) as Record<string, unknown>,
      },
    });
  },
});
