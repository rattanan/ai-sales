import { createAIProvider } from "@/server/ai/factory";
import { ntopSalesIntentSchema, type NtopSalesIntent } from "@/schemas/ntop";

const SALES_SIGNAL =
  /\b(?:prospect|lead|opportunit(?:y|ies)|customer|quotation|quote|pipeline|budget|proposal|products?|solution design)\b|ลูกค้า|ผู้มุ่งหวัง|โอกาสขาย|ใบเสนอราคา|สินค้า|ผลิตภัณฑ์|โซลูชัน|ออกแบบ|งบประมาณ|งบ\s*\d|สนใจ|จัดซื้อ|เคยคุย|ปิดการขาย|ยอดขาย/iu;

const COMPANY_PREFIX =
  /(?:บริษัท|บ\.|ลูกค้า(?:บริษัท)?|company|customer)\s*[:：-]?\s*([\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} .&_-]{0,80}?)(?=\s+(?:สนใจ|ต้องการ|อยาก|มี|งบ|คุย|ติดต่อ|ขอ|ใช้|จะ|ให้|ช่วย|กรุณา)|[,，]|$)/iu;

const ACRONYM_COMPANY_EXCLUSIONS = new Set([
  "DR",
  "FIX",
  "FIXED",
  "IP",
  "NT",
  "NTOP",
  "Q1",
  "Q2",
  "Q3",
  "Q4",
  "SME",
]);

function emptyIntent(): NtopSalesIntent {
  return {
    intent: "NONE",
    company: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    requirement: null,
    solution: null,
    estimatedValue: null,
    expectedCloseDate: null,
    opportunityId: null,
    quotationId: null,
  };
}

function explicitWriteIntent(
  message: string,
): NtopSalesIntent["intent"] | null {
  const createVerb = /(?:สร้าง|เพิ่ม|บันทึก|เก็บ|create|add|save)/iu;
  if (!createVerb.test(message)) return null;
  if (/\bprospect\b|ผู้มุ่งหวัง/iu.test(message)) return "CREATE_PROSPECT";
  if (/\blead\b/iu.test(message)) return "CREATE_LEAD";
  if (/\bopportunity\b|โอกาสขาย/iu.test(message)) return "CREATE_OPPORTUNITY";
  if (/\bquotation\b|\bquote\b|ใบเสนอราคา/iu.test(message))
    return "CREATE_QUOTATION";
  return null;
}

function extractCompany(message: string) {
  const prefixed = message.match(COMPANY_PREFIX)?.[1]?.trim();
  if (prefixed) return prefixed;
  return (
    [...message.matchAll(/\b([A-Z][A-Z0-9&.-]{1,30})\b/g)]
      .map((match) => match[1])
      .find((candidate) => !ACRONYM_COMPANY_EXCLUSIONS.has(candidate)) ?? null
  );
}

function fallbackFromSingleMessage(message: string): NtopSalesIntent {
  if (!SALES_SIGNAL.test(message)) return emptyIntent();
  const company = extractCompany(message);
  const million = message.match(
    /(?:งบประมาณ|งบ|มูลค่า)\s*(?:ประมาณ)?\s*([\d,.]+)\s*ล้าน/iu,
  );
  const plainValue = message.match(
    /(?:งบประมาณ|งบ|มูลค่า)\s*(?:ประมาณ)?\s*([\d,]+)(?:\s*บาท)?/iu,
  );
  const estimatedValue = million
    ? String(Math.round(Number(million[1].replaceAll(",", "")) * 1_000_000))
    : plainValue
      ? plainValue[1].replaceAll(",", "")
      : null;
  const solution =
    message
      .match(
        /(?:สนใจ|ต้องการ(?:จะ)?(?:ใช้|ซื้อ)?|อยาก(?:ใช้|ซื้อ)?)\s+(.+?)(?=\s+(?:งบประมาณ|งบ|มูลค่า|คาด|คาดว่า|จะจัดซื้อ|ช่วย|กรุณา|ขอ)|[,，]|$)/u,
      )?.[1]
      ?.trim() ?? null;
  const writeIntent = explicitWriteIntent(message);
  const lookup =
    /อย่างไร|เป็นยังไง|สถานะ|ล่าสุด|เคยคุย|quotation|ใบเสนอราคา|pipeline/iu.test(
      message,
    ) && !estimatedValue;
  return {
    ...emptyIntent(),
    intent:
      writeIntent ??
      (lookup
        ? "LOOKUP"
        : estimatedValue || solution
          ? "CREATE_OPPORTUNITY"
          : "LOOKUP"),
    company,
    requirement: solution,
    solution,
    estimatedValue,
    expectedCloseDate: /\bQ4\b|ไตรมาส\s*4/iu.test(message)
      ? `${new Date().getUTCFullYear()}-12-31T00:00:00.000Z`
      : null,
    contactEmail: message.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/)?.[0] ?? null,
    contactPhone:
      message.match(/(?:\+?66|0)\d[\d -]{7,12}/)?.[0]?.replaceAll(" ", "") ??
      null,
  };
}

function mergeRecentContext(
  current: NtopSalesIntent,
  contextMessages: string[],
) {
  if (current.company) return current;
  let resolved = current;
  for (const contextMessage of [...contextMessages].reverse()) {
    const prior = fallbackFromSingleMessage(contextMessage);
    resolved = {
      ...resolved,
      company: resolved.company ?? prior.company,
      contactName: resolved.contactName ?? prior.contactName,
      contactEmail: resolved.contactEmail ?? prior.contactEmail,
      contactPhone: resolved.contactPhone ?? prior.contactPhone,
      requirement: resolved.requirement ?? prior.requirement,
      solution: resolved.solution ?? prior.solution,
      estimatedValue: resolved.estimatedValue ?? prior.estimatedValue,
      expectedCloseDate: resolved.expectedCloseDate ?? prior.expectedCloseDate,
    };
    if (resolved.company) break;
  }
  return resolved;
}

export function fallbackNtopSalesIntent(
  message: string,
  contextMessages: string[] = [],
): NtopSalesIntent {
  const current = fallbackFromSingleMessage(message);
  return explicitWriteIntent(message)
    ? mergeRecentContext(current, contextMessages)
    : current;
}

export async function detectNtopSalesIntent(
  message: string,
  contextMessages: string[] = [],
) {
  if (!SALES_SIGNAL.test(message)) return emptyIntent();
  const fallback = fallbackNtopSalesIntent(message, contextMessages);
  try {
    const result = await createAIProvider().generateStructuredOutput({
      requestId: crypto.randomUUID(),
      schemaName: "ntop_sales_intent",
      outputSchema: ntopSalesIntentSchema,
      promptVersion: "ntop-sales-intent-v2",
      systemPrompt:
        "Classify the current sales intent and extract only facts explicitly present in the current message or recent user context. The current message determines the intent; use recent context only to resolve omitted company names and facts in follow-up commands. Use NONE for unrelated chat, LOOKUP for questions about existing business records, and a write intent when the user describes a sales fact suitable for that record. An explicit request to create a Prospect must be CREATE_PROSPECT. Money must be a decimal string in THB. Resolve relative quarter dates using the supplied current date. Never invent contact details, record IDs, products, prices, or dates. Return the required JSON object only.",
      userPrompt: JSON.stringify({
        currentDate: new Date().toISOString(),
        currentMessage: message,
        resolvedRecentContext: explicitWriteIntent(message) ? fallback : null,
      }),
    });
    if (!result.ok) return fallback;
    const detected = result.data.data;
    const forcedIntent = explicitWriteIntent(message);
    const describedSalesFact =
      fallback.company &&
      (fallback.requirement || fallback.solution || fallback.estimatedValue);
    return {
      ...detected,
      intent:
        forcedIntent ??
        (describedSalesFact && ["NONE", "LOOKUP"].includes(detected.intent)
          ? fallback.intent
          : detected.intent),
      company: fallback.company ?? detected.company,
      contactName: detected.contactName ?? fallback.contactName,
      contactEmail: detected.contactEmail ?? fallback.contactEmail,
      contactPhone: detected.contactPhone ?? fallback.contactPhone,
      requirement: detected.requirement ?? fallback.requirement,
      solution: detected.solution ?? fallback.solution,
      estimatedValue: detected.estimatedValue ?? fallback.estimatedValue,
      expectedCloseDate:
        detected.expectedCloseDate ?? fallback.expectedCloseDate,
    };
  } catch {
    return fallback;
  }
}

export function hasNtopSalesSignal(message: string) {
  return SALES_SIGNAL.test(message);
}
