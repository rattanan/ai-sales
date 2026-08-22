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
  "CUSTOMER" | "PROSPECT" | "LEAD" | "OPPORTUNITY" | "QUOTATION" | "PRODUCT";

type LookupPlan = {
  kind: LookupKind | null;
  queries: string[];
  label: string;
  filter: boolean;
};

const LOOKUP_REQUEST =
  /(?:ค้น|หา|ดู|ดึง|แสดง|ลิสต์|รายการ|อะไรบ้าง|สถานะ|ล่าสุด|find|search|show|list|get)/iu;

export function hasExplicitNtopLookup(message: string) {
  return (
    LOOKUP_REQUEST.test(message) &&
    /(?:(?:จาก|ใน)\s*ntop\b|\bntop\b)/iu.test(message)
  );
}

function requestedLookupKind(message: string): LookupKind | null {
  if (/\bprospect\b|ผู้มุ่งหวัง/iu.test(message)) return "PROSPECT";
  if (/\blead\b/iu.test(message)) return "LEAD";
  if (/\bopportunit(?:y|ies)\b|โอกาสขาย/iu.test(message)) return "OPPORTUNITY";
  if (/\bquotation\b|\bquote\b|ใบเสนอราคา/iu.test(message)) return "QUOTATION";
  if (/\bproduct\b|สินค้า|ผลิตภัณฑ์/iu.test(message)) return "PRODUCT";
  if (/\bcustomer\b|ลูกค้า/iu.test(message)) return "CUSTOMER";
  return null;
}

function lookupCandidates(value: string) {
  const candidates = value
    .split(/\s+(?:หรือ|or)\s+/iu)
    .map((item) => item.trim().replace(/^["“”']+|["“”'.,，]+$/gu, ""))
    .filter(Boolean)
    .flatMap((item) => {
      const compact = item.includes(".") ? item.replace(/[.\s]/gu, "") : item;
      return compact && compact !== item ? [item, compact] : [item];
    });
  return [...new Set(candidates)];
}

function explicitNtopQuery(message: string) {
  return message
    .replace(/(?:จาก|ใน)\s*ntop\b/giu, " ")
    .replace(/\bntop\b/giu, " ")
    .replace(
      /^(?:ช่วย\s*)?(?:ค้นหา|ค้น|หา|ดู|ดึง|แสดง|ลิสต์)\s*(?:ข้อมูล(?:ของ)?\s*)?/iu,
      "",
    )
    .replace(
      /\b(?:prospects?|leads?|customers?|opportunit(?:y|ies)|quotations?|quotes?|products?)\b|ลูกค้า|ผู้มุ่งหวัง|โอกาสขาย|ใบเสนอราคา|สินค้า|ผลิตภัณฑ์/giu,
      " ",
    )
    .replace(/\s*(?:ให้หน่อย|ให้ที|หน่อย|ที|ครับ|ค่ะ|คะ)\s*$/iu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function lookupPlan(
  message: string,
  company: string | null,
): LookupPlan | null {
  const kind = requestedLookupKind(message);
  const explicitNtop = hasExplicitNtopLookup(message);
  if (/(?:สร้าง|เพิ่ม|บันทึก|เก็บ|create|add|save)/iu.test(message))
    return null;
  if (!kind && !explicitNtop) return null;
  if (!LOOKUP_REQUEST.test(message)) return null;

  const filter = message
    .match(
      /(?:ที่เป็น|ประเภท|กลุ่ม|อุตสาหกรรม)\s*[:：-]?\s*["“”']?(.+?)["“”']?(?=\s*(?:จาก|ใน)\s+ntop\b|[?？]|$)/iu,
    )?.[1]
    ?.trim();
  if (filter) {
    const queries = lookupCandidates(filter);
    if (queries.length) return { kind, queries, label: filter, filter: true };
  }

  if (company) {
    const queries = lookupCandidates(company);
    if (queries.length) return { kind, queries, label: company, filter: false };
  }

  if (!explicitNtop) return null;
  const query = explicitNtopQuery(message);
  const explicitQueries = lookupCandidates(query);
  return explicitQueries.length
    ? { kind, queries: explicitQueries, label: query, filter: false }
    : null;
}

function displayValue(record: RecordValue, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

async function searchQueries(
  queries: string[],
  search: (query: string) => Promise<RecordValue[]>,
) {
  const records = (await Promise.all(queries.map(search))).flat();
  const seen = new Set<string>();
  return records.filter((record) => {
    const key =
      displayValue(
        record,
        "id",
        "prospectCode",
        "customerNumber",
        "customerCode",
        "leadNumber",
        "opportunityNumber",
        "quotationNumber",
        "quoteNumber",
        "productCode",
        "code",
      ) || JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  filter = false,
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
      ? filter
        ? `พบ ${requested} ที่ตรงกับ “${company}” ใน NTOP จำนวน ${selected.length} รายการ\n\n${lines.join("\n")}`
        : `พบ ${requested} ของ ${company} ใน NTOP จำนวน ${selected.length} รายการ\n\n${lines.join("\n")}`
      : filter
        ? `Found ${selected.length} ${requested.toLowerCase()} record(s) matching “${company}” in NTOP.\n\n${lines.join("\n")}`
        : `Found ${selected.length} ${requested.toLowerCase()} record(s) for ${company} in NTOP.\n\n${lines.join("\n")}`;
  }
  const counts = Object.entries(groups)
    .filter(([, records]) => records.length)
    .map(([kind, records]) => `${kind}: ${records.length}`);
  if (!counts.length)
    return isThaiMessage
      ? filter && requested
        ? `ไม่พบ ${requested} ที่ตรงกับ “${company}” ใน NTOP`
        : `ไม่พบข้อมูลของ ${company} ใน NTOP`
      : filter && requested
        ? `No ${requested.toLowerCase()} records matching “${company}” were found in NTOP.`
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
  const explicitNtopLookup = hasExplicitNtopLookup(message);
  const fallbackLookup = lookupPlan(message, fallbackIntent.company);
  const connection = await configuredNtopConnectionForUser(userId, {
    allowLegacyKey: true,
  });
  if (!connection) {
    const lookupTarget =
      fallbackLookup?.label ?? fallbackIntent.company ?? "NTOP";
    if (
      (fallbackIntent.intent === "NONE" || !fallbackIntent.company) &&
      !fallbackLookup &&
      !explicitNtopLookup
    )
      return { evidence: [], toolUsed: false };
    return {
      evidence: [],
      toolUsed: true,
      warning: /[\u0E00-\u0E7F]/.test(message)
        ? explicitNtopLookup ||
          fallbackLookup ||
          fallbackIntent.intent === "LOOKUP"
          ? `ตรวจพบคำขอค้นข้อมูลของ ${lookupTarget} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
          : `ตรวจพบข้อมูลที่เหมาะสำหรับบันทึกเป็น Prospect ของ ${fallbackIntent.company} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
        : explicitNtopLookup ||
            fallbackLookup ||
            fallbackIntent.intent === "LOOKUP"
          ? `I detected an NTOP lookup for ${lookupTarget}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the integration and try again.`
          : `This looks suitable for a Prospect for ${fallbackIntent.company}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the NTOP integration and try again.`,
      toolErrorCode: "NTOP_NOT_CONFIGURED",
    };
  }
  const { client } = connection;
  const intent = await detectNtopSalesIntent(message, contextMessages);
  const deterministicLookup = lookupPlan(
    message,
    intent.company ?? fallbackIntent.company,
  );
  if (
    (intent.intent === "NONE" || !intent.company) &&
    !deterministicLookup &&
    !explicitNtopLookup
  )
    return { evidence: [], toolUsed: false };
  if (explicitNtopLookup && !deterministicLookup)
    return {
      evidence: [],
      toolUsed: true,
      message: /[\u0E00-\u0E7F]/.test(message)
        ? "กรุณาระบุชื่อบริษัท ประเภทข้อมูล หรือคำค้นที่ต้องการค้นจาก NTOP"
        : "Specify a company, record type, or search term to look up in NTOP.",
    };
  const isLookup =
    explicitNtopLookup ||
    Boolean(deterministicLookup) ||
    intent.intent === "LOOKUP";
  const lookupKind = isLookup
    ? (deterministicLookup?.kind ?? requestedLookupKind(message))
    : null;
  const searchTerms = deterministicLookup?.queries ?? [intent.company!];
  const productLookup =
    lookupKind === "PRODUCT"
      ? searchQueries(searchTerms, (query) => client.searchProduct(query))
      : Promise.resolve([]);
  const [customers, prospects, leads, opportunities, quotations, products] =
    await Promise.all([
      !lookupKind || lookupKind === "CUSTOMER"
        ? searchQueries(searchTerms, (query) => client.searchCustomer(query))
        : Promise.resolve([]),
      !lookupKind || lookupKind === "PROSPECT"
        ? searchQueries(searchTerms, (query) => client.searchProspect(query))
        : Promise.resolve([]),
      !lookupKind || lookupKind === "LEAD"
        ? searchQueries(searchTerms, (query) => client.searchLead(query))
        : Promise.resolve([]),
      !lookupKind || lookupKind === "OPPORTUNITY"
        ? searchQueries(searchTerms, (query) => client.searchOpportunity(query))
        : Promise.resolve([]),
      !lookupKind || lookupKind === "QUOTATION"
        ? searchQueries(searchTerms, (query) => client.searchQuotation(query))
        : Promise.resolve([]),
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
  if (isLookup) {
    const firstOpportunity = opportunities[0] as RecordValue | undefined;
    const detail =
      firstOpportunity && typeof firstOpportunity.id === "string"
        ? await client.getOpportunity(firstOpportunity.id).catch(() => null)
        : null;
    return {
      evidence: evidence(
        detail ? [...combined, detail] : combined,
        deterministicLookup?.label ?? intent.company!,
      ),
      toolUsed: true,
      message: lookupMessage(
        message,
        deterministicLookup?.label ?? intent.company!,
        groups,
        deterministicLookup?.filter,
      ),
    };
  }
  const company = intent.company;
  if (!company) return { evidence: [], toolUsed: false };

  if (connection.credentialSource !== "USER")
    return {
      evidence: evidence(combined, company),
      toolUsed: true,
      warning: /[\u0E00-\u0E7F]/.test(message)
        ? `พบข้อมูลของ ${company} แล้ว แต่ยังเสนอรายการเขียนไม่ได้ กรุณาเชื่อม personal NTOP API Key ในหน้า Profile แล้วลองอีกครั้ง`
        : `I found records for ${company}, but cannot propose a write yet. Connect your personal NTOP API Key in Profile and try again.`,
      toolErrorCode: "NTOP_PERSONAL_KEY_REQUIRED",
    };

  const existingOpportunity = (opportunities as RecordValue[]).find((item) =>
    exactCompany(item, company),
  );
  if (existingOpportunity)
    return {
      evidence: evidence(combined, company),
      toolUsed: true,
      message: `พบ Opportunity ที่เกี่ยวข้องกับ ${company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ กรุณาระบุว่าต้องการอัปเดต Opportunity ใด`,
    };
  const customer = (customers as RecordValue[]).find((item) =>
    exactCompany(item, company),
  );
  const prospect = (prospects as RecordValue[]).find((item) =>
    exactCompany(item, company),
  );
  const lead = (leads as RecordValue[]).find((item) =>
    exactCompany(item, company),
  );

  if (lead) {
    return {
      evidence: evidence(combined, company),
      toolUsed: true,
      message: `พบ Lead ของ ${company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ`,
    };
  }

  if (
    customer &&
    typeof customer.id === "string" &&
    (intent.requirement || intent.solution || intent.estimatedValue)
  ) {
    const name = `${company} - ${intent.solution ?? intent.requirement ?? "New Opportunity"}`;
    return {
      evidence: evidence(combined, company),
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
      evidence: evidence(combined, company),
      toolUsed: true,
      action: {
        type: "CREATE_LEAD",
        title: `Lead ใหม่: ${company}`,
        summary: `${company} · ${intent.solution ?? intent.requirement ?? "Sales inquiry"}`,
        payload: {
          company,
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
      evidence: evidence(combined, company),
      toolUsed: true,
      message: `พบ Prospect ของ ${company} อยู่แล้วใน NTOP จึงยังไม่เสนอสร้างรายการซ้ำ กรุณาระบุข้อมูลผู้ติดต่อหากต้องการสร้าง Lead`,
    };
  }

  if (customer) {
    return {
      evidence: evidence(combined, company),
      toolUsed: true,
      message: `พบ Customer ${company} ใน NTOP แล้ว แต่ข้อมูลยังไม่เพียงพอสำหรับสร้าง Opportunity กรุณาระบุ Requirement หรือ Solution ที่สนใจ`,
    };
  }

  return {
    evidence: evidence(combined, company),
    toolUsed: true,
    action: {
      type: "CREATE_PROSPECT",
      title: `Prospect ใหม่: ${company}`,
      summary: `${company} · ${intent.solution ?? intent.requirement ?? "Sales inquiry"} · ${money(intent.estimatedValue)}`,
      payload: {
        companyName: company,
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
