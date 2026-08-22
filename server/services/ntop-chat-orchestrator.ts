import type { NtopActionType } from "@/generated/prisma/client";
import { configuredNtopConnectionForUser } from "@/server/integrations/ntop/client";
import {
  detectNtopSalesIntent,
  fallbackNtopSalesIntent,
} from "@/server/services/ntop-intent-service";

type RecordValue = Record<string, unknown>;

export type NtopActionDraft = {
  type: NtopActionType;
  title: string;
  summary: string;
  payload: RecordValue;
};
export type NtopChatOutcome = {
  evidence: Array<{
    content: string;
    contentHash: string;
    metadata: RecordValue;
    documentId: string;
    sourceId: string;
    documentName: string;
    mimeType: string;
    vectorScore: number;
    keywordScore: number;
    score: number;
  }>;
  action?: NtopActionDraft;
  message?: string;
  warning?: string;
  toolErrorCode?:
    "NTOP_NOT_CONFIGURED" | "NTOP_PERSONAL_KEY_REQUIRED" | "NTOP_UNAVAILABLE";
  toolUsed: boolean;
};

function text(record: RecordValue, ...keys: string[]) {
  for (const key of keys)
    if (typeof record[key] === "string") return record[key] as string;
  return "";
}

function exactCompany(record: RecordValue, company: string) {
  const candidate = text(
    record,
    "name",
    "companyName",
    "company",
  ).toLocaleLowerCase();
  return (
    candidate === company.toLocaleLowerCase() ||
    candidate.includes(company.toLocaleLowerCase())
  );
}

function evidence(records: RecordValue[], query: string) {
  if (!records.length) return [];
  return [
    {
      content: JSON.stringify(records).slice(0, 30_000),
      contentHash: crypto.randomUUID(),
      metadata: { sourceType: "NTOP", systemOfRecord: true, query },
      documentId: "ntop-business-memory",
      sourceId: "ntop",
      documentName: "NTOP Business Memory",
      mimeType: "application/vnd.ntop.business-memory+json",
      vectorScore: 0,
      keywordScore: 1,
      score: 1,
    },
  ];
}

function money(value: string | null) {
  return value
    ? `${Number(value).toLocaleString("en-US")} THB`
    : "ยังไม่ระบุมูลค่า";
}

type LookupKind =
  | "CUSTOMER"
  | "PROSPECT"
  | "LEAD"
  | "OPPORTUNITY"
  | "QUOTATION"
  | "PRODUCT";

function requestedLookupKind(message: string): LookupKind | null {
  if (/\bprospect\b|ผู้มุ่งหวัง/iu.test(message)) return "PROSPECT";
  if (/\blead\b/iu.test(message)) return "LEAD";
  if (/\bopportunit(?:y|ies)\b|โอกาสขาย/iu.test(message))
    return "OPPORTUNITY";
  if (/\bquotation\b|\bquote\b|ใบเสนอราคา/iu.test(message))
    return "QUOTATION";
  if (/\bproduct\b|สินค้า|ผลิตภัณฑ์/iu.test(message)) return "PRODUCT";
  if (/\bcustomer\b|ลูกค้า/iu.test(message)) return "CUSTOMER";
  return null;
}

function displayValue(record: RecordValue, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function lookupRecordLine(kind: LookupKind, record: RecordValue) {
  const identifiers: Record<LookupKind, string[]> = {
    CUSTOMER: ["customerNumber", "customerCode", "name"],
    PROSPECT: ["prospectCode", "companyName"],
    LEAD: ["leadNumber", "company"],
    OPPORTUNITY: ["opportunityNumber", "name"],
    QUOTATION: ["quotationNumber", "quoteNumber", "name"],
    PRODUCT: ["productCode", "code", "name"],
  };
  const names: Record<LookupKind, string[]> = {
    CUSTOMER: ["name", "companyName"],
    PROSPECT: ["companyName", "companyNameEnglish"],
    LEAD: ["company", "contactName"],
    OPPORTUNITY: ["name", "companyName"],
    QUOTATION: ["name", "title"],
    PRODUCT: ["name", "productName"],
  };
  const identifier = displayValue(record, ...identifiers[kind]);
  const name = displayValue(record, ...names[kind]);
  const status = displayValue(record, "status", "stage", "active");
  return [...new Set([identifier, name, status].filter(Boolean))].join(" · ");
}

function lookupMessage(
  message: string,
  company: string,
  groups: Record<LookupKind, RecordValue[]>,
) {
  const requested = requestedLookupKind(message);
  const selected = requested ? groups[requested] : [];
  const isThaiMessage = /[\u0E00-\u0E7F]/.test(message);
  if (requested && selected.length) {
    const lines = selected
      .slice(0, 10)
      .map(
        (record, index) =>
          `${index + 1}. ${lookupRecordLine(requested, record)}`,
      );
    return isThaiMessage
      ? `พบ ${requested} ของ ${company} ใน NTOP จำนวน ${selected.length} รายการ\n\n${lines.join("\n")}`
      : `Found ${selected.length} ${requested.toLowerCase()} record(s) for ${company} in NTOP.\n\n${lines.join("\n")}`;
  }
  const counts = Object.entries(groups)
    .filter(([, records]) => records.length)
    .map(([kind, records]) => `${kind}: ${records.length}`);
  if (!counts.length)
    return isThaiMessage
      ? `ไม่พบข้อมูลของ ${company} ใน NTOP`
      : `No NTOP records were found for ${company}.`;
  return isThaiMessage
    ? `พบข้อมูลของ ${company} ใน NTOP: ${counts.join(", ")}`
    : `Found NTOP records for ${company}: ${counts.join(", ")}`;
}

export async function orchestrateNtopChat(
  userId: string,
  message: string,
  options: { contextMessages?: string[] } = {},
): Promise<NtopChatOutcome> {
  const contextMessages = options.contextMessages ?? [];
  const fallbackIntent = fallbackNtopSalesIntent(message, contextMessages);
  const connection = await configuredNtopConnectionForUser(userId, {
    allowLegacyKey: true,
  });
  if (!connection) {
    if (fallbackIntent.intent === "NONE" || !fallbackIntent.company)
      return { evidence: [], toolUsed: false };
    return {
      evidence: [],
      toolUsed: true,
      warning: /[\u0E00-\u0E7F]/.test(message)
        ? fallbackIntent.intent === "LOOKUP"
          ? `ตรวจพบคำขอค้นข้อมูลของ ${fallbackIntent.company} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
          : `ตรวจพบข้อมูลที่เหมาะสำหรับบันทึกเป็น Prospect ของ ${fallbackIntent.company} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
        : fallbackIntent.intent === "LOOKUP"
          ? `I detected an NTOP lookup for ${fallbackIntent.company}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the integration and try again.`
          : `This looks suitable for a Prospect for ${fallbackIntent.company}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the NTOP integration and try again.`,
      toolErrorCode: "NTOP_NOT_CONFIGURED",
    };
  }
  const { client } = connection;
  const intent = await detectNtopSalesIntent(message, contextMessages);
  if (intent.intent === "NONE" || !intent.company)
    return { evidence: [], toolUsed: false };
  const productLookup =
    intent.intent === "LOOKUP" && requestedLookupKind(message) === "PRODUCT"
      ? client.searchProduct(intent.company)
      : Promise.resolve([]);
  const [customers, prospects, leads, opportunities, quotations, products] =
    await Promise.all([
      client.searchCustomer(intent.company),
      client.searchProspect(intent.company),
      client.searchLead(intent.company),
      client.searchOpportunity(intent.company),
      client.searchQuotation(intent.company),
      productLookup,
    ]);
  const groups: Record<LookupKind, RecordValue[]> = {
    CUSTOMER: customers as RecordValue[],
    PROSPECT: prospects as RecordValue[],
    LEAD: leads as RecordValue[],
    OPPORTUNITY: opportunities as RecordValue[],
    QUOTATION: quotations as RecordValue[],
    PRODUCT: products as RecordValue[],
  };
  const combined = [
    ...customers,
    ...prospects,
    ...leads,
    ...opportunities,
    ...quotations,
    ...products,
  ] as RecordValue[];
  if (intent.intent === "LOOKUP") {
    const firstOpportunity = opportunities[0] as RecordValue | undefined;
    const detail =
      firstOpportunity && typeof firstOpportunity.id === "string"
        ? await client.getOpportunity(firstOpportunity.id).catch(() => null)
        : null;
    return {
      evidence: evidence(
        detail ? [...combined, detail] : combined,
        intent.company,
      ),
      toolUsed: true,
      message: lookupMessage(message, intent.company, groups),
    };
  }

  if (connection.credentialSource !== "USER")
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      warning: /[\u0E00-\u0E7F]/.test(message)
        ? `พบข้อมูลของ ${intent.company} แล้ว แต่ยังเสนอรายการเขียนไม่ได้ กรุณาเชื่อม personal NTOP API Key ในหน้า Profile แล้วลองอีกครั้ง`
        : `I found records for ${intent.company}, but cannot propose a write yet. Connect your personal NTOP API Key in Profile and try again.`,
      toolErrorCode: "NTOP_PERSONAL_KEY_REQUIRED",
    };

  const existingOpportunity = (opportunities as RecordValue[]).find((item) =>
    exactCompany(item, intent.company!),
  );
  if (existingOpportunity)
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      message: `พบ Opportunity ที่เกี่ยวข้องกับ ${intent.company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ กรุณาระบุว่าต้องการอัปเดต Opportunity ใด`,
    };
  const customer = (customers as RecordValue[]).find((item) =>
    exactCompany(item, intent.company!),
  );
  const prospect = (prospects as RecordValue[]).find((item) =>
    exactCompany(item, intent.company!),
  );
  const lead = (leads as RecordValue[]).find((item) =>
    exactCompany(item, intent.company!),
  );

  if (lead) {
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      message: `พบ Lead ของ ${intent.company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ`,
    };
  }

  if (
    customer &&
    typeof customer.id === "string" &&
    (intent.requirement || intent.solution || intent.estimatedValue)
  ) {
    const name = `${intent.company} - ${intent.solution ?? intent.requirement ?? "New Opportunity"}`;
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      action: {
        type: "CREATE_OPPORTUNITY",
        title: `Opportunity ใหม่: ${name}`,
        summary: `${name} · Estimated Value ${money(intent.estimatedValue)}`,
        payload: {
          name,
          customerId: customer.id,
          flow: "STANDARD",
          estimatedValue: intent.estimatedValue ?? "0",
          currency: "THB",
          probability: 10,
          forecastCategory: "PIPELINE",
          expectedCloseAt: intent.expectedCloseDate,
          nextAction: "Confirm requirements with customer",
          requirements: intent.requirement,
          qualificationResult: null,
          stakeholderSummary: intent.contactName,
          assessment: {
            incumbentVendor: null,
            competitors: null,
            approach: "DIRECT",
            confidence: 50,
            rationale: "Created from user-confirmed AI-Sales conversation",
          },
        },
      },
    };
  }

  if (
    prospect &&
    intent.intent === "CREATE_LEAD" &&
    intent.contactName &&
    (intent.contactEmail || intent.contactPhone)
  ) {
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      action: {
        type: "CREATE_LEAD",
        title: `Lead ใหม่: ${intent.company}`,
        summary: `${intent.company} · ${intent.solution ?? intent.requirement ?? "Sales inquiry"}`,
        payload: {
          company: intent.company,
          contactName: intent.contactName,
          contactEmail: intent.contactEmail ?? "",
          contactPhone: intent.contactPhone ?? undefined,
          source: "API",
          status: "NEW",
          score: 0,
          recommendedProducts: intent.solution ?? undefined,
          notes: intent.requirement ?? intent.solution ?? undefined,
        },
      },
    };
  }

  if (prospect) {
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      message: `พบ Prospect ของ ${intent.company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ กรุณาระบุข้อมูลผู้ติดต่อหากต้องการสร้าง Lead`,
    };
  }

  if (customer) {
    return {
      evidence: evidence(combined, intent.company),
      toolUsed: true,
      message: `พบ Customer ${intent.company} ใน NTOP แล้ว แต่ข้อมูลยังไม่เพียงพอสำหรับสร้าง Opportunity กรุณาระบุ Requirement หรือ Solution ที่สนใจ`,
    };
  }

  return {
    evidence: evidence(combined, intent.company),
    toolUsed: true,
    action: {
      type: "CREATE_PROSPECT",
      title: `Prospect ใหม่: ${intent.company}`,
      summary: `${intent.company} · ${intent.solution ?? intent.requirement ?? "Sales inquiry"} · ${money(intent.estimatedValue)}`,
      payload: {
        companyName: intent.company,
        source: "MANUAL",
        status: "NEW",
        businessPainPoints: intent.requirement ?? undefined,
        recommendedProducts: intent.solution ?? undefined,
        expectedBudget: intent.estimatedValue ?? undefined,
        estimatedOpportunityValue: intent.estimatedValue ?? undefined,
        expectedPurchasePeriod: intent.expectedCloseDate ?? undefined,
        notes: message,
      },
    },
  };
}
