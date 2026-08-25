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
  /(?:ค้น|หา|ดู|ดึง|แสดง|ลิสต์|รายการ|อะไรบ้าง|รายละเอียด|สถานะ|ล่าสุด|find|search|show|list|get|details?)/iu;

const DETAIL_REQUEST =
  /(?:รายละเอียด|ข้อมูลทั้งหมด|เจาะลึก|full details?|details?)/iu;

const SOLUTION_DESIGN_REQUEST =
  /(?:ออกแบบ|(?:ช่วย|ขอ|กรุณา)\s*(?:จัดทำ|ทำ))\s*(?:solution(?:\s*design)?|โซลูชัน)?|\b(?:design|recommend|propose)\s+(?:an?\s+)?solution\b/iu;

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
      /^(?:ช่วย\s*)?(?:ขอ\s*)?(?:ค้นหา|ค้น|หา|ดู|ดึง|แสดง|ลิสต์|รายละเอียด|details?)\s*(?:ข้อมูล(?:ของ)?\s*)?/iu,
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

function detailCandidate(
  records: RecordValue[],
  queries: string[],
  identifierKeys: string[],
) {
  const normalizedQueries = new Set(
    queries.map((query) => query.toLocaleLowerCase()),
  );
  return (
    records.find((record) =>
      identifierKeys.some((key) => {
        const value = displayValue(record, key);
        return value && normalizedQueries.has(value.toLocaleLowerCase());
      }),
    ) ?? (records.length === 1 ? records[0] : undefined)
  );
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

function nestedDisplayValue(
  record: RecordValue,
  key: string,
  nestedKey = "name",
) {
  const value = record[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  return displayValue(value as RecordValue, nestedKey);
}

function localizedDate(value: unknown, locale: string) {
  if (typeof value !== "string" && !(value instanceof Date)) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? ""
    : new Intl.DateTimeFormat(locale, {
        dateStyle: "medium",
        timeZone: "Asia/Bangkok",
      }).format(date);
}

function localizedMoney(record: RecordValue, key: string, locale: string) {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") return "";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const currency = displayValue(record, "currency") || "THB";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function localizedNumber(record: RecordValue, key: string, locale: string) {
  const value = record[key];
  if (typeof value !== "string" && typeof value !== "number") return "";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 4 }).format(amount)
    : "";
}

function localizedBoolean(
  record: RecordValue,
  key: string,
  isThaiMessage: boolean,
) {
  return typeof record[key] === "boolean"
    ? record[key]
      ? isThaiMessage
        ? "ใช่"
        : "Yes"
      : isThaiMessage
        ? "ไม่ใช่"
        : "No"
    : "";
}

function prospectDetailMessage(record: RecordValue, isThaiMessage: boolean) {
  const locale = isThaiMessage ? "th-TH" : "en-US";
  const fields: Array<[string, string]> = isThaiMessage
    ? [
        ["บริษัท", displayValue(record, "companyName")],
        ["ชื่อภาษาอังกฤษ", displayValue(record, "companyNameEnglish")],
        ["สถานะ", displayValue(record, "status")],
        ["ระดับความสนใจ", displayValue(record, "heatLevel")],
        ["คะแนน", displayValue(record, "calculatedScore")],
        ["อุตสาหกรรม", nestedDisplayValue(record, "industry")],
        [
          "ประเภทธุรกิจ",
          displayValue(record, "customerType", "organizationType"),
        ],
        ["ขนาดบริษัท", displayValue(record, "companySize")],
        ["จังหวัด", displayValue(record, "province")],
        ["เว็บไซต์", displayValue(record, "website")],
        ["แหล่งที่มา", displayValue(record, "sourceName", "source")],
        ["ผู้รับผิดชอบ", nestedDisplayValue(record, "owner")],
        ["ปัญหาธุรกิจ", displayValue(record, "businessPainPoints")],
        ["งบประมาณที่คาด", localizedMoney(record, "expectedBudget", locale)],
        [
          "มูลค่าโอกาสโดยประมาณ",
          localizedMoney(record, "estimatedOpportunityValue", locale),
        ],
        ["ผลิตภัณฑ์แนะนำ", displayValue(record, "recommendedProducts")],
        ["การติดต่อล่าสุด", localizedDate(record.lastContactAt, locale)],
        ["นัดติดตามครั้งถัดไป", localizedDate(record.nextFollowUpAt, locale)],
        ["ขั้นตอนถัดไป", displayValue(record, "suggestedNextAction")],
        ["หมายเหตุ", displayValue(record, "notes")],
        ["อัปเดตล่าสุด", localizedDate(record.updatedAt, locale)],
      ]
    : [
        ["Company", displayValue(record, "companyName")],
        ["English name", displayValue(record, "companyNameEnglish")],
        ["Status", displayValue(record, "status")],
        ["Heat level", displayValue(record, "heatLevel")],
        ["Score", displayValue(record, "calculatedScore")],
        ["Industry", nestedDisplayValue(record, "industry")],
        [
          "Business type",
          displayValue(record, "customerType", "organizationType"),
        ],
        ["Company size", displayValue(record, "companySize")],
        ["Province", displayValue(record, "province")],
        ["Website", displayValue(record, "website")],
        ["Source", displayValue(record, "sourceName", "source")],
        ["Owner", nestedDisplayValue(record, "owner")],
        ["Business pain points", displayValue(record, "businessPainPoints")],
        ["Expected budget", localizedMoney(record, "expectedBudget", locale)],
        [
          "Estimated opportunity value",
          localizedMoney(record, "estimatedOpportunityValue", locale),
        ],
        ["Recommended products", displayValue(record, "recommendedProducts")],
        ["Last contact", localizedDate(record.lastContactAt, locale)],
        ["Next follow-up", localizedDate(record.nextFollowUpAt, locale)],
        ["Next action", displayValue(record, "suggestedNextAction")],
        ["Notes", displayValue(record, "notes")],
        ["Last updated", localizedDate(record.updatedAt, locale)],
      ];
  const identifier = displayValue(record, "prospectCode");
  const lines = fields
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return isThaiMessage
    ? `รายละเอียด Prospect ${identifier} จาก NTOP\n\n${lines.join("\n")}`
    : `Prospect ${identifier} details from NTOP\n\n${lines.join("\n")}`;
}

function leadDetailMessage(record: RecordValue, isThaiMessage: boolean) {
  const locale = isThaiMessage ? "th-TH" : "en-US";
  const fields: Array<[string, string]> = isThaiMessage
    ? [
        ["บริษัท", displayValue(record, "company")],
        ["สถานะ", displayValue(record, "status")],
        ["ความสำคัญ", displayValue(record, "priority")],
        ["ระดับความสนใจ", displayValue(record, "temperature")],
        ["คะแนน", displayValue(record, "score")],
        ["อุตสาหกรรม", displayValue(record, "industry")],
        ["แหล่งที่มา", displayValue(record, "source")],
        ["ผู้รับผิดชอบ", nestedDisplayValue(record, "owner")],
        ["ความต้องการ", displayValue(record, "requirementSummary")],
        ["ผลิตภัณฑ์แนะนำ", displayValue(record, "recommendedProducts")],
        [
          "งบประมาณโดยประมาณ",
          localizedMoney(record, "estimatedBudget", locale),
        ],
        ["พื้นที่ให้บริการ", displayValue(record, "serviceLocations")],
        ["ติดต่อล่าสุด", localizedDate(record.lastContactedAt, locale)],
        ["นัดติดตามครั้งถัดไป", localizedDate(record.nextFollowUpAt, locale)],
        ["คาดว่าจะจัดซื้อ", localizedDate(record.expectedPurchaseAt, locale)],
        ["ผลการ Qualification", displayValue(record, "qualificationResult")],
        ["หมายเหตุ", displayValue(record, "notes")],
        ["อัปเดตล่าสุด", localizedDate(record.updatedAt, locale)],
      ]
    : [
        ["Company", displayValue(record, "company")],
        ["Status", displayValue(record, "status")],
        ["Priority", displayValue(record, "priority")],
        ["Temperature", displayValue(record, "temperature")],
        ["Score", displayValue(record, "score")],
        ["Industry", displayValue(record, "industry")],
        ["Source", displayValue(record, "source")],
        ["Owner", nestedDisplayValue(record, "owner")],
        ["Requirements", displayValue(record, "requirementSummary")],
        ["Recommended products", displayValue(record, "recommendedProducts")],
        ["Estimated budget", localizedMoney(record, "estimatedBudget", locale)],
        ["Service locations", displayValue(record, "serviceLocations")],
        ["Last contacted", localizedDate(record.lastContactedAt, locale)],
        ["Next follow-up", localizedDate(record.nextFollowUpAt, locale)],
        ["Expected purchase", localizedDate(record.expectedPurchaseAt, locale)],
        ["Qualification result", displayValue(record, "qualificationResult")],
        ["Notes", displayValue(record, "notes")],
        ["Last updated", localizedDate(record.updatedAt, locale)],
      ];
  const identifier = displayValue(record, "leadNumber");
  const lines = fields
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return isThaiMessage
    ? `รายละเอียด Lead ${identifier} จาก NTOP\n\n${lines.join("\n")}`
    : `Lead ${identifier} details from NTOP\n\n${lines.join("\n")}`;
}

function productDetailMessage(record: RecordValue, isThaiMessage: boolean) {
  const locale = isThaiMessage ? "th-TH" : "en-US";
  const fields: Array<[string, string]> = isThaiMessage
    ? [
        ["ชื่อผลิตภัณฑ์", displayValue(record, "name", "productName")],
        ["หมวดหมู่", displayValue(record, "category")],
        ["รายละเอียด", displayValue(record, "description")],
        ["List price จาก NTOP", localizedNumber(record, "listPrice", locale)],
        ["รหัส Service Category", displayValue(record, "serviceCategoryCode")],
        [
          "ต้องสำรวจพื้นที่",
          localizedBoolean(record, "requiresSiteSurvey", true),
        ],
        ["ต้องจัดทำ BOQ", localizedBoolean(record, "requiresBoq", true)],
        [
          "ต้องติดตั้งอุปกรณ์",
          localizedBoolean(record, "requiresPhysicalInstallation", true),
        ],
        ["เปิดใช้งาน", localizedBoolean(record, "active", true)],
        ["อัปเดตล่าสุด", localizedDate(record.updatedAt, locale)],
      ]
    : [
        ["Product", displayValue(record, "name", "productName")],
        ["Category", displayValue(record, "category")],
        ["Description", displayValue(record, "description")],
        ["NTOP list price", localizedNumber(record, "listPrice", locale)],
        ["Service category code", displayValue(record, "serviceCategoryCode")],
        [
          "Site survey required",
          localizedBoolean(record, "requiresSiteSurvey", false),
        ],
        ["BOQ required", localizedBoolean(record, "requiresBoq", false)],
        [
          "Physical installation required",
          localizedBoolean(record, "requiresPhysicalInstallation", false),
        ],
        ["Active", localizedBoolean(record, "active", false)],
        ["Last updated", localizedDate(record.updatedAt, locale)],
      ];
  const identifier = displayValue(record, "productCode", "code");
  const lines = fields
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return isThaiMessage
    ? `รายละเอียด Product ${identifier} จาก NTOP\n\n${lines.join("\n")}`
    : `Product ${identifier} details from NTOP\n\n${lines.join("\n")}`;
}

function solutionDesignFacts(
  message: string,
  contextMessages: string[],
  current: ReturnType<typeof fallbackNtopSalesIntent>,
) {
  let company = current.company;
  let requirement = current.requirement ?? current.solution;
  if (!SOLUTION_DESIGN_REQUEST.test(message)) return { company, requirement };
  for (const contextMessage of [...contextMessages].reverse()) {
    if (company && requirement) break;
    const prior = fallbackNtopSalesIntent(contextMessage);
    company ??= prior.company;
    requirement ??= prior.requirement ?? prior.solution;
  }
  return { company, requirement };
}

function productSearchQueries(value: string) {
  const stopWords = new Set([
    "a",
    "an",
    "and",
    "for",
    "the",
    "with",
    "ลูกค้า",
    "ต้องการ",
    "ระบบ",
    "สำหรับ",
    "และ",
    "พร้อม",
    "ใช้",
  ]);
  const segments = value
    .split(
      /[,，;；+]|\s+(?:และ|พร้อม|รวมถึง|กับ|สำหรับ|เพื่อ)\s*|\s+(?:and|with|for|plus)\s+/iu,
    )
    .map((item) => item.trim())
    .filter(Boolean);
  const tokens = segments.flatMap((segment) =>
    segment
      .split(/\s+/u)
      .map((item) => item.trim())
      .filter(
        (item) =>
          item.length > 1 &&
          !stopWords.has(item.toLocaleLowerCase()) &&
          !/^\d+(?:\.\d+)?$/u.test(item),
      ),
  );
  return [...new Set([value.trim(), ...segments, ...tokens])]
    .filter(Boolean)
    .slice(0, 8);
}

function solutionProductFact(record: RecordValue) {
  return {
    id: displayValue(record, "id"),
    code: displayValue(record, "code", "productCode"),
    name: displayValue(record, "name", "productName"),
    category: displayValue(record, "category"),
    description: displayValue(record, "description"),
    listPrice: displayValue(record, "listPrice"),
    serviceCategoryCode: displayValue(record, "serviceCategoryCode"),
    requiresSiteSurvey:
      typeof record.requiresSiteSurvey === "boolean"
        ? record.requiresSiteSurvey
        : undefined,
    requiresBoq:
      typeof record.requiresBoq === "boolean" ? record.requiresBoq : undefined,
    requiresPhysicalInstallation:
      typeof record.requiresPhysicalInstallation === "boolean"
        ? record.requiresPhysicalInstallation
        : undefined,
  };
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
  const solutionDesignRequested = SOLUTION_DESIGN_REQUEST.test(message);
  const fallbackDesignFacts = solutionDesignFacts(
    message,
    contextMessages,
    fallbackIntent,
  );
  const explicitNtopLookup = hasExplicitNtopLookup(message);
  const fallbackLookup = lookupPlan(
    message,
    fallbackIntent.company ?? fallbackDesignFacts.company,
  );
  const connection = await configuredNtopConnectionForUser(userId, {
    allowLegacyKey: true,
  });
  if (!connection) {
    const lookupTarget =
      fallbackLookup?.label ?? fallbackIntent.company ?? "NTOP";
    if (
      (fallbackIntent.intent === "NONE" || !fallbackIntent.company) &&
      !fallbackLookup &&
      !explicitNtopLookup &&
      !solutionDesignRequested
    )
      return { evidence: [], toolUsed: false };
    return {
      evidence: [],
      toolUsed: true,
      warning: /[\u0E00-\u0E7F]/.test(message)
        ? explicitNtopLookup ||
          fallbackLookup ||
          solutionDesignRequested ||
          fallbackIntent.intent === "LOOKUP"
          ? `ตรวจพบคำขอค้นข้อมูลของ ${lookupTarget} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
          : `ตรวจพบข้อมูลที่เหมาะสำหรับบันทึกเป็น Prospect ของ ${fallbackIntent.company} แต่ AI-Sales ยังไม่ได้เชื่อมต่อ NTOP กรุณาให้ผู้ดูแลตั้งค่า NTOP integration แล้วลองอีกครั้ง`
        : explicitNtopLookup ||
            fallbackLookup ||
            solutionDesignRequested ||
            fallbackIntent.intent === "LOOKUP"
          ? `I detected an NTOP lookup for ${lookupTarget}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the integration and try again.`
          : `This looks suitable for a Prospect for ${fallbackIntent.company}, but AI-Sales is not connected to NTOP. Ask an administrator to configure the NTOP integration and try again.`,
      toolErrorCode: "NTOP_NOT_CONFIGURED",
    };
  }
  const { client } = connection;
  const intent = await detectNtopSalesIntent(message, contextMessages);
  const designFacts = solutionDesignFacts(message, contextMessages, {
    ...fallbackIntent,
    ...intent,
    company: intent.company ?? fallbackDesignFacts.company,
    requirement:
      intent.requirement ?? fallbackDesignFacts.requirement ?? intent.solution,
    solution:
      intent.solution ?? fallbackDesignFacts.requirement ?? intent.requirement,
  });
  const deterministicLookup = lookupPlan(
    message,
    intent.company ?? fallbackIntent.company ?? designFacts.company,
  );
  if (
    (intent.intent === "NONE" || !intent.company) &&
    !deterministicLookup &&
    !explicitNtopLookup &&
    !solutionDesignRequested
  )
    return { evidence: [], toolUsed: false };
  if (explicitNtopLookup && !deterministicLookup && !solutionDesignRequested)
    return {
      evidence: [],
      toolUsed: true,
      message: /[\u0E00-\u0E7F]/.test(message)
        ? "กรุณาระบุชื่อบริษัท ประเภทข้อมูล หรือคำค้นที่ต้องการค้นจาก NTOP"
        : "Specify a company, record type, or search term to look up in NTOP.",
    };
  if (solutionDesignRequested) {
    const sourceQueries = designFacts.company
      ? lookupCandidates(designFacts.company)
      : [];
    const [prospectRecords, leadRecords] = sourceQueries.length
      ? await Promise.all([
          searchQueries(sourceQueries, (query) => client.searchProspect(query)),
          searchQueries(sourceQueries, (query) => client.searchLead(query)),
        ])
      : [[], []];
    const firstProspect = detailCandidate(prospectRecords, sourceQueries, [
      "id",
      "prospectCode",
      "companyName",
    ]);
    const firstLead = detailCandidate(leadRecords, sourceQueries, [
      "id",
      "leadNumber",
      "company",
    ]);
    const [prospectDetail, leadDetail] = await Promise.all([
      typeof firstProspect?.id === "string"
        ? client.getProspect(firstProspect.id).catch(() => firstProspect)
        : Promise.resolve(firstProspect),
      typeof firstLead?.id === "string"
        ? client.getLead(firstLead.id).catch(() => firstLead)
        : Promise.resolve(firstLead),
    ]);
    const requirementParts = [
      designFacts.requirement,
      prospectDetail ? displayValue(prospectDetail, "recommendedProducts") : "",
      prospectDetail ? displayValue(prospectDetail, "businessPainPoints") : "",
      leadDetail ? displayValue(leadDetail, "recommendedProducts") : "",
      leadDetail ? displayValue(leadDetail, "requirementSummary") : "",
    ].filter((value): value is string => Boolean(value));
    const requirements = [...new Set(requirementParts)].join(", ");
    if (!requirements)
      return {
        evidence: [],
        toolUsed: true,
        message: /[\u0E00-\u0E7F]/.test(message)
          ? "กรุณาระบุความต้องการของลูกค้า หรือระบุ Prospect/Lead ที่มี Requirement ใน NTOP ก่อนให้ออกแบบ Solution"
          : "Specify the customer requirements, or identify a Prospect/Lead with requirements in NTOP before requesting a Solution Design.",
      };
    const productRecords = (
      await searchQueries(productSearchQueries(requirements), (query) =>
        client.searchProduct(query),
      )
    ).filter((record) => record.active !== false);
    if (!productRecords.length)
      return {
        evidence: evidence(
          [
            {
              company: designFacts.company,
              customerRequirements: requirements,
            },
          ],
          requirements,
        ),
        toolUsed: true,
        message: /[\u0E00-\u0E7F]/.test(message)
          ? `ไม่พบ Product ที่ตรงกับความต้องการ “${requirements}” ใน NTOP จึงยังออกแบบ Solution และระบุราคาไม่ได้`
          : `No NTOP Product matched “${requirements}”, so a grounded Solution Design with pricing cannot be produced yet.`,
      };
    const productDetails = (
      await Promise.all(
        productRecords
          .slice(0, 10)
          .map((record) =>
            typeof record.id === "string"
              ? client.getProduct(record.id)
              : Promise.resolve(record),
          ),
      )
    ).filter((record) => record.active !== false);
    if (!productDetails.length)
      return {
        evidence: [],
        toolUsed: true,
        message: /[\u0E00-\u0E7F]/.test(message)
          ? "Product ที่ค้นพบถูกปิดใช้งานแล้ว จึงไม่นำมาใช้จัดทำ Solution Design"
          : "The matching Products are inactive and were excluded from the Solution Design.",
      };
    return {
      evidence: evidence(
        [
          {
            sourceType: "NTOP_SOLUTION_DESIGN_CONTEXT",
            company: designFacts.company,
            customerRequirements: requirements,
            products: productDetails.map(solutionProductFact),
          },
        ],
        requirements,
      ),
      toolUsed: true,
    };
  }
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
    const detailRequested = DETAIL_REQUEST.test(message);
    const firstProspect = detailCandidate(
      prospects as RecordValue[],
      searchTerms,
      ["id", "prospectCode", "companyName"],
    );
    const firstLead = detailCandidate(leads as RecordValue[], searchTerms, [
      "id",
      "leadNumber",
      "company",
    ]);
    const firstOpportunity = detailCandidate(
      opportunities as RecordValue[],
      searchTerms,
      ["id", "opportunityNumber", "name"],
    );
    const firstProduct = detailCandidate(
      products as RecordValue[],
      searchTerms,
      ["id", "productCode", "code", "name"],
    );
    const detail = detailRequested
      ? lookupKind === "PROSPECT" && typeof firstProspect?.id === "string"
        ? await client.getProspect(firstProspect.id)
        : lookupKind === "LEAD" && typeof firstLead?.id === "string"
          ? await client.getLead(firstLead.id)
          : lookupKind === "OPPORTUNITY" &&
              typeof firstOpportunity?.id === "string"
            ? await client.getOpportunity(firstOpportunity.id)
            : lookupKind === "PRODUCT" && typeof firstProduct?.id === "string"
              ? await client.getProduct(firstProduct.id)
              : null
      : null;
    return {
      evidence: evidence(
        detail ? [...combined, detail] : combined,
        deterministicLookup?.label ?? intent.company!,
      ),
      toolUsed: true,
      message:
        detail && lookupKind === "PROSPECT"
          ? prospectDetailMessage(detail, /[\u0E00-\u0E7F]/.test(message))
          : detail && lookupKind === "LEAD"
            ? leadDetailMessage(detail, /[\u0E00-\u0E7F]/.test(message))
            : detail && lookupKind === "PRODUCT"
              ? productDetailMessage(detail, /[\u0E00-\u0E7F]/.test(message))
              : lookupMessage(
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
