import { z } from "zod";
import { configuredNtopConnectionForUser } from "@/server/integrations/ntop/client";
import {
  defineAgentTool,
  toolFailure,
  toolSuccess,
  type AgentRunContext,
  type AgentToolDefinition,
  type GroundingEvidence,
} from "@/server/ai/agent/types";

type RecordValue = Record<string, unknown>;

const LOOKUP_KINDS = [
  "CUSTOMER",
  "PROSPECT",
  "LEAD",
  "OPPORTUNITY",
  "QUOTATION",
  "PRODUCT",
] as const;
type LookupKind = (typeof LOOKUP_KINDS)[number];

type NtopClient = NonNullable<
  Awaited<ReturnType<typeof configuredNtopConnectionForUser>>
>["client"];

function searchFor(client: NtopClient, kind: LookupKind, query: string) {
  switch (kind) {
    case "CUSTOMER":
      return client.searchCustomer(query);
    case "PROSPECT":
      return client.searchProspect(query);
    case "LEAD":
      return client.searchLead(query);
    case "OPPORTUNITY":
      return client.searchOpportunity(query);
    case "QUOTATION":
      return client.searchQuotation(query);
    case "PRODUCT":
      return client.searchProduct(query);
  }
}

function getFor(client: NtopClient, kind: LookupKind, id: string) {
  switch (kind) {
    case "CUSTOMER":
      return client.getCustomer(id);
    case "PROSPECT":
      return client.getProspect(id);
    case "LEAD":
      return client.getLead(id);
    case "OPPORTUNITY":
      return client.getOpportunity(id);
    case "QUOTATION":
      return client.getQuotation(id);
    case "PRODUCT":
      return client.getProduct(id);
  }
}

function ntopEvidence(
  records: unknown,
  label: string,
  kind: LookupKind,
): GroundingEvidence[] {
  const rows = Array.isArray(records) ? records : [records];
  if (!rows.length) return [];
  return [
    {
      content: JSON.stringify(rows).slice(0, 30_000),
      contentHash: crypto.randomUUID(),
      metadata: {
        sourceType: "NTOP",
        systemOfRecord: true,
        kind,
        query: label,
      },
      documentId: "ntop-business-memory",
      sourceId: "ntop",
      documentName: `NTOP ${kind}`,
      mimeType: "application/vnd.ntop.business-memory+json",
      vectorScore: 0,
      keywordScore: 1,
      score: 1,
    },
  ];
}

function optionalText(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * NTOP tools for this turn. Reads run against the caller's own NTOP
 * connection; writes never run at all — they return a proposal that only
 * `confirmNtopAction` can execute, after the user presses confirm.
 */
export async function buildNtopTools(
  context: AgentRunContext,
): Promise<AgentToolDefinition[]> {
  const connection = await configuredNtopConnectionForUser(
    context.authorization.userId,
    { allowLegacyKey: true },
  );
  if (!connection) return [];
  const { client, credentialSource } = connection;
  // A shared legacy key identifies the platform, not the person, so it may
  // read but must never stand behind a proposed write.
  const canProposeWrites = credentialSource === "USER";

  const tools: AgentToolDefinition[] = [
    defineAgentTool({
      name: "ntop_search",
      kind: "DYNAMIC",
      codeDefinedName: true,
      access: "READ",
      group: "NTOP",
      description:
        "ค้นหาข้อมูลในระบบ NTOP ซึ่งเป็นระบบงานขายที่เป็นแหล่งข้อมูลจริงขององค์กร (ลูกค้า ผู้มุ่งหวัง โอกาสขาย ใบเสนอราคา สินค้า) " +
        "ใช้เมื่อผู้ใช้ถามถึงลูกค้าหรือดีลที่ระบุชื่อ " +
        "ไม่ใช่เอกสารนโยบายหรือคู่มือ (กรณีนั้นให้ใช้ search_documents) และไม่ใช่ข้อมูลสาธารณะบนเว็บ (กรณีนั้นให้ใช้ web_search) " +
        "เรียก ntop_get ต่อเพื่อดูรายละเอียดเต็มของรายการที่พบ",
      parameters: z.object({
        kind: z.enum(LOOKUP_KINDS).describe("ประเภทข้อมูลที่ต้องการค้นใน NTOP"),
        query: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("ชื่อบริษัท ชื่อสินค้า หรือคำค้นอื่น"),
      }),
      async execute(_runContext, args) {
        try {
          const records = await searchFor(client, args.kind, args.query);
          const rows = (Array.isArray(records) ? records : []) as RecordValue[];
          if (!rows.length)
            return toolSuccess(
              `ไม่พบ ${args.kind} ที่ตรงกับ "${args.query}" ใน NTOP`,
            );
          return toolSuccess(
            `พบ ${args.kind} ${rows.length} รายการใน NTOP`,
            ntopEvidence(rows, args.query, args.kind),
          );
        } catch {
          return toolFailure(
            "เชื่อมต่อ NTOP ไม่ได้ในขณะนี้ ให้แจ้งผู้ใช้แทนการเดาข้อมูล",
            "NTOP_UNAVAILABLE",
          );
        }
      },
    }),
    defineAgentTool({
      name: "ntop_get",
      kind: "DYNAMIC",
      codeDefinedName: true,
      access: "READ",
      group: "NTOP",
      description:
        "อ่านรายละเอียดเต็มของรายการเดียวใน NTOP ด้วย id ที่ได้จาก ntop_search " +
        "ใช้เมื่อผู้ใช้ต้องการรายละเอียดเชิงลึกของลูกค้า ผู้มุ่งหวัง โอกาสขาย ใบเสนอราคา หรือสินค้ารายการใดรายการหนึ่ง",
      parameters: z.object({
        kind: z.enum(LOOKUP_KINDS).describe("ประเภทของรายการ"),
        id: z.string().trim().min(1).describe("id ของรายการจาก ntop_search"),
      }),
      async execute(_runContext, args) {
        try {
          const record = await getFor(client, args.kind, args.id);
          if (!record)
            return toolSuccess(`ไม่พบ ${args.kind} id ${args.id} ใน NTOP`);
          return toolSuccess(
            `รายละเอียด ${args.kind} จาก NTOP`,
            ntopEvidence(record, args.id, args.kind),
          );
        } catch {
          return toolFailure(
            "อ่านข้อมูลจาก NTOP ไม่สำเร็จในขณะนี้ ให้แจ้งผู้ใช้แทนการเดาข้อมูล",
            "NTOP_UNAVAILABLE",
          );
        }
      },
    }),
  ];

  if (!canProposeWrites) return tools;

  const writeNotice =
    "เครื่องมือนี้ไม่บันทึกข้อมูลทันที แต่จะสร้างรายการรอให้ผู้ใช้กดยืนยันในหน้าจอ ห้ามบอกผู้ใช้ว่าบันทึกสำเร็จแล้ว";

  tools.push(
    defineAgentTool({
      name: "ntop_propose_prospect",
      kind: "DYNAMIC",
      codeDefinedName: true,
      access: "WRITE",
      group: "NTOP",
      description: `เสนอสร้าง Prospect (ผู้มุ่งหวัง) ใหม่ใน NTOP สำหรับบริษัทที่ยังไม่มีในระบบ ตรวจด้วย ntop_search ก่อนเสมอว่ายังไม่มีข้อมูลซ้ำ ${writeNotice}`,
      parameters: z.object({
        companyName: z.string().trim().min(1).max(200).describe("ชื่อบริษัท"),
        businessPainPoints: z
          .string()
          .max(2_000)
          .optional()
          .describe("ปัญหาหรือความต้องการทางธุรกิจที่ผู้ใช้ระบุ"),
        recommendedProducts: z
          .string()
          .max(1_000)
          .optional()
          .describe("สินค้าหรือโซลูชันที่แนะนำ"),
        expectedBudget: z
          .string()
          .max(50)
          .optional()
          .describe("งบประมาณที่คาดไว้เป็นตัวเลข"),
        expectedPurchasePeriod: z
          .string()
          .max(50)
          .optional()
          .describe("ช่วงเวลาที่คาดว่าจะซื้อ"),
      }),
      async execute(runContext, args) {
        return toolSuccess(
          `เตรียมรายการสร้าง Prospect "${args.companyName}" รอผู้ใช้ยืนยัน`,
          [],
          {
            proposal: {
              type: "CREATE_PROSPECT",
              title: `Prospect ใหม่: ${args.companyName}`,
              summary: [
                args.companyName,
                optionalText(args.recommendedProducts) ??
                  optionalText(args.businessPainPoints) ??
                  "Sales inquiry",
                optionalText(args.expectedBudget)
                  ? `${args.expectedBudget} THB`
                  : "ยังไม่ระบุมูลค่า",
              ].join(" · "),
              payload: {
                companyName: args.companyName,
                source: "MANUAL",
                status: "NEW",
                businessPainPoints: optionalText(args.businessPainPoints),
                recommendedProducts: optionalText(args.recommendedProducts),
                expectedBudget: optionalText(args.expectedBudget),
                estimatedOpportunityValue: optionalText(args.expectedBudget),
                expectedPurchasePeriod: optionalText(
                  args.expectedPurchasePeriod,
                ),
                notes: runContext.userMessage,
              },
            },
          },
        );
      },
    }),
    defineAgentTool({
      name: "ntop_propose_lead",
      kind: "DYNAMIC",
      codeDefinedName: true,
      access: "WRITE",
      group: "NTOP",
      description: `เสนอสร้าง Lead ใหม่ใน NTOP สำหรับบริษัทที่มี Prospect อยู่แล้วและได้ข้อมูลผู้ติดต่อครบ ต้องมีอย่างน้อยอีเมลหรือเบอร์โทร ${writeNotice}`,
      parameters: z.object({
        company: z.string().trim().min(1).max(200).describe("ชื่อบริษัท"),
        contactName: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("ชื่อผู้ติดต่อ"),
        contactEmail: z.string().max(200).optional().describe("อีเมลผู้ติดต่อ"),
        contactPhone: z
          .string()
          .max(50)
          .optional()
          .describe("เบอร์โทรผู้ติดต่อ"),
        recommendedProducts: z
          .string()
          .max(1_000)
          .optional()
          .describe("สินค้าหรือโซลูชันที่แนะนำ"),
        notes: z.string().max(2_000).optional().describe("บันทึกเพิ่มเติม"),
      }),
      async execute(_runContext, args) {
        if (
          !optionalText(args.contactEmail) &&
          !optionalText(args.contactPhone)
        )
          return toolFailure(
            "สร้าง Lead ต้องมีอีเมลหรือเบอร์โทรของผู้ติดต่ออย่างน้อยหนึ่งอย่าง ให้ถามผู้ใช้ก่อน",
            "NTOP_LEAD_CONTACT_REQUIRED",
          );
        return toolSuccess(
          `เตรียมรายการสร้าง Lead ของ "${args.company}" รอผู้ใช้ยืนยัน`,
          [],
          {
            proposal: {
              type: "CREATE_LEAD",
              title: `Lead ใหม่: ${args.company}`,
              summary: `${args.company} · ${optionalText(args.recommendedProducts) ?? optionalText(args.notes) ?? "Sales inquiry"}`,
              payload: {
                company: args.company,
                contactName: args.contactName,
                contactEmail: optionalText(args.contactEmail) ?? "",
                contactPhone: optionalText(args.contactPhone),
                source: "API",
                status: "NEW",
                score: 0,
                recommendedProducts: optionalText(args.recommendedProducts),
                notes: optionalText(args.notes),
              },
            },
          },
        );
      },
    }),
    defineAgentTool({
      name: "ntop_propose_opportunity",
      kind: "DYNAMIC",
      codeDefinedName: true,
      access: "WRITE",
      group: "NTOP",
      description:
        "เสนอสร้าง Opportunity (โอกาสขาย) ใหม่ใน NTOP สำหรับลูกค้าที่มีอยู่แล้วในระบบ " +
        "ต้องใช้ customerId จาก ntop_search kind=CUSTOMER และตรวจก่อนว่ายังไม่มี Opportunity ซ้ำ " +
        "ถ้าค้นแล้วบริษัทนั้นยังเป็นแค่ Prospect หรือ Lead ยังไม่ได้เป็นลูกค้า จะสร้าง Opportunity ไม่ได้ " +
        "ห้ามเดา customerId ขึ้นมาเอง ให้แจ้งผู้ใช้ว่าต้องแปลง Lead เป็นลูกค้าใน NTOP ก่อน แล้วค่อยกลับมาสร้างโอกาสขาย " +
        writeNotice,
      parameters: z.object({
        customerId: z
          .string()
          .trim()
          .min(1)
          .describe("id ของลูกค้าจาก ntop_search kind=CUSTOMER"),
        companyName: z
          .string()
          .trim()
          .min(1)
          .max(200)
          .describe("ชื่อบริษัทลูกค้า ใช้ตั้งชื่อโอกาสขาย"),
        solution: z
          .string()
          .trim()
          .min(1)
          .max(500)
          .describe("โซลูชันหรือสิ่งที่ลูกค้าสนใจ"),
        requirements: z
          .string()
          .max(2_000)
          .optional()
          .describe("ความต้องการของลูกค้า"),
        estimatedValue: z
          .string()
          .max(50)
          .optional()
          .describe("มูลค่าที่คาดการณ์เป็นตัวเลข ไม่ระบุ = 0"),
        expectedCloseAt: z
          .string()
          .max(50)
          .optional()
          .describe("วันที่คาดว่าจะปิดการขาย รูปแบบ YYYY-MM-DD"),
        stakeholderSummary: z
          .string()
          .max(500)
          .optional()
          .describe("ผู้เกี่ยวข้องฝั่งลูกค้า"),
      }),
      async execute(_runContext, args) {
        const name = `${args.companyName} - ${args.solution}`;
        return toolSuccess(
          `เตรียมรายการสร้าง Opportunity "${name}" รอผู้ใช้ยืนยัน`,
          [],
          {
            proposal: {
              type: "CREATE_OPPORTUNITY",
              title: `Opportunity ใหม่: ${name}`,
              summary: `${name} · Estimated Value ${optionalText(args.estimatedValue) ? `${Number(args.estimatedValue).toLocaleString("en-US")} THB` : "ยังไม่ระบุมูลค่า"}`,
              payload: {
                name,
                customerId: args.customerId,
                flow: "STANDARD",
                estimatedValue: optionalText(args.estimatedValue) ?? "0",
                currency: "THB",
                probability: 10,
                forecastCategory: "PIPELINE",
                expectedCloseAt: optionalText(args.expectedCloseAt),
                nextAction: "Confirm requirements with customer",
                requirements: optionalText(args.requirements),
                qualificationResult: null,
                stakeholderSummary: optionalText(args.stakeholderSummary),
                assessment: {
                  incumbentVendor: null,
                  competitors: null,
                  approach: "DIRECT",
                  confidence: 50,
                  rationale:
                    "Created from user-confirmed AI-Sales conversation",
                },
              },
            },
          },
        );
      },
    }),
  );
  return tools;
}
