import { createAIProvider } from "@/server/ai/factory";
import { ntopSalesIntentSchema, type NtopSalesIntent } from "@/schemas/ntop";

const SALES_SIGNAL =
  /\b(?:prospect|lead|opportunit(?:y|ies)|customer|quotation|quote|pipeline|budget|proposal)\b|ลูกค้า|ผู้มุ่งหวัง|โอกาสขาย|ใบเสนอราคา|งบประมาณ|งบ\s*\d|สนใจ|จัดซื้อ|เคยคุย|ปิดการขาย|ยอดขาย/iu;

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

export function fallbackNtopSalesIntent(message: string): NtopSalesIntent {
  if (!SALES_SIGNAL.test(message)) return emptyIntent();
  const company =
    message
      .match(
        /(?:บริษัท|บ\.)\s*([\p{L}\p{N}][\p{L}\p{N} .&_-]{1,80}?)(?=\s+(?:สนใจ|ต้องการ|มี|งบ|คุย|ติดต่อ)|[,，]|$)/u,
      )?.[1]
      ?.trim() ??
    message.match(/\b([A-Z][A-Z0-9&.-]{1,30})\b/)?.[1] ??
    null;
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
        /สนใจ\s+(.+?)(?=\s+(?:งบประมาณ|งบ|มูลค่า|คาด|คาดว่า|จะจัดซื้อ)|[,，]|$)/u,
      )?.[1]
      ?.trim() ?? null;
  const lookup =
    /อย่างไร|เป็นยังไง|สถานะ|ล่าสุด|เคยคุย|quotation|ใบเสนอราคา|pipeline/iu.test(
      message,
    ) && !estimatedValue;
  return {
    ...emptyIntent(),
    intent: lookup
      ? "LOOKUP"
      : estimatedValue || solution
        ? "CREATE_OPPORTUNITY"
        : "LOOKUP",
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

export async function detectNtopSalesIntent(message: string) {
  if (!SALES_SIGNAL.test(message)) return emptyIntent();
  const fallback = fallbackNtopSalesIntent(message);
  try {
    const result = await createAIProvider().generateStructuredOutput({
      requestId: crypto.randomUUID(),
      schemaName: "ntop_sales_intent",
      outputSchema: ntopSalesIntentSchema,
      promptVersion: "ntop-sales-intent-v1",
      systemPrompt:
        "Classify sales intent and extract only facts explicitly present in the message. Use NONE for unrelated chat, LOOKUP for questions about existing business records, and a write intent only when the user describes a fact suitable for that record. Money must be a decimal string in THB. Resolve relative quarter dates using the supplied current date. Never invent contact details, record IDs, products, prices, or dates. Return the required JSON object only.",
      userPrompt: JSON.stringify({
        currentDate: new Date().toISOString(),
        message,
      }),
    });
    return result.ok ? result.data.data : fallback;
  } catch {
    return fallback;
  }
}

export function hasNtopSalesSignal(message: string) {
  return SALES_SIGNAL.test(message);
}
