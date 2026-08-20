const SENSITIVE_COLUMN =
  /pass(word)?|secret|token|api.?key|auth|national.?id|ssn|tax.?id|credit.?card|card.?number|cvv|email|phone|mobile|address|passport|health|medical|diagnos|religion|biometric|fingerprint|face.?print|โรค|สุขภาพ|ศาสนา|ลายนิ้วมือ/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[\d().\s-]{8,20}$/;
const LONG_OPAQUE = /^[A-Za-z0-9_\-/+=]{24,}$/;

export type PiiMaskingRules = {
  maskEmail: boolean;
  maskPhone: boolean;
  maskNationalId: boolean;
  maskFinancialAccount: boolean;
  maskPassport?: boolean;
  maskHealth?: boolean;
  maskReligion?: boolean;
  maskBiometric?: boolean;
  customMaskTerms?: string[];
};

export type SensitiveDataCategory =
  | "EMAIL"
  | "PHONE"
  | "NATIONAL_ID"
  | "FINANCIAL_ACCOUNT"
  | "PASSPORT"
  | "HEALTH"
  | "RELIGION"
  | "BIOMETRIC"
  | "SECRET"
  | "POLICY";

const DEFAULT_MASKING_RULES: PiiMaskingRules = {
  maskEmail: true,
  maskPhone: true,
  maskNationalId: true,
  maskFinancialAccount: true,
  maskPassport: true,
  maskHealth: true,
  maskReligion: true,
  maskBiometric: true,
  customMaskTerms: [],
};

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function maskSensitiveText(
  value: string,
  maskingRules: PiiMaskingRules = DEFAULT_MASKING_RULES,
) {
  let text = value;
  const counts: Partial<Record<SensitiveDataCategory, number>> = {};
  const replace = (
    category: SensitiveDataCategory,
    pattern: RegExp,
    enabled = true,
  ) => {
    if (!enabled) return;
    text = text.replace(pattern, () => {
      counts[category] = (counts[category] ?? 0) + 1;
      return `[MASKED_${category}]`;
    });
  };

  replace(
    "SECRET",
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  );
  replace("SECRET", /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi);
  replace("SECRET", /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g);
  replace(
    "SECRET",
    /(?:password|passcode|secret|token|credential|api[_ -]?key|authorization)\s*[:=]\s*[^\s,;]+/gi,
  );
  replace("EMAIL", /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, maskingRules.maskEmail);
  replace(
    "NATIONAL_ID",
    /(?<!\d)\d(?:[- ]?\d){12}(?!\d)/g,
    maskingRules.maskNationalId,
  );
  replace(
    "PASSPORT",
    /(?:passport|หนังสือเดินทาง)\s*(?:no\.?|number|เลขที่)?\s*[:=]?\s*[A-Z]{1,2}\d{6,8}/gi,
    maskingRules.maskPassport !== false,
  );
  replace(
    "PASSPORT",
    /\b[A-Z]{1,2}\d{6,8}\b/g,
    maskingRules.maskPassport !== false,
  );
  replace(
    "HEALTH",
    /(?:health|medical|diagnosis|condition|disease|สุขภาพ|การวินิจฉัย|โรค|ประวัติการรักษา)\s*[:=]\s*[^\n,;]{1,120}/gi,
    maskingRules.maskHealth !== false,
  );
  replace(
    "RELIGION",
    /(?:religion|faith|ศาสนา|ความเชื่อ)\s*[:=]\s*[^\n,;]{1,80}/gi,
    maskingRules.maskReligion !== false,
  );
  replace(
    "BIOMETRIC",
    /(?:biometric|fingerprint|faceprint|voiceprint|iris|ลายนิ้วมือ|ใบหน้า|ม่านตา|เสียง)\s*[:=]\s*[^\n,;]{1,120}/gi,
    maskingRules.maskBiometric !== false,
  );
  replace(
    "PHONE",
    /(?<!\d)(?:\+\d[\d(). -]{7,16}\d|0\d[\d(). -]{7,10}\d)(?!\d)/g,
    maskingRules.maskPhone,
  );
  if (maskingRules.maskFinancialAccount)
    text = text.replace(/(?<!\d)\d(?:[ -]?\d){12,18}(?!\d)/g, (candidate) => {
      if (!passesLuhn(candidate)) return candidate;
      counts.FINANCIAL_ACCOUNT = (counts.FINANCIAL_ACCOUNT ?? 0) + 1;
      return "[MASKED_FINANCIAL_ACCOUNT]";
    });
  for (const term of maskingRules.customMaskTerms ?? []) {
    if (term.length < 2 || term.length > 80) continue;
    replace(
      "POLICY",
      new RegExp(`${escaped(term)}\\s*[:=]\\s*[^\\n,;]{1,120}`, "gi"),
    );
  }
  return {
    text,
    counts,
    total: Object.values(counts).reduce((total, count) => total + count, 0),
    categories: Object.keys(counts) as SensitiveDataCategory[],
  };
}

function passesLuhn(value: string) {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

export function isLikelySensitive(columnName: string, value: unknown) {
  if (SENSITIVE_COLUMN.test(columnName)) return value != null;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return (
    EMAIL.test(trimmed) ||
    PHONE.test(trimmed) ||
    passesLuhn(trimmed) ||
    LONG_OPAQUE.test(trimmed)
  );
}

export function sanitizeSampleCell(
  columnName: string,
  value: unknown,
  options: {
    maskSensitiveData: boolean;
    maxLength: number;
    maskingRules?: PiiMaskingRules;
  },
): unknown {
  const rules = options.maskingRules ?? DEFAULT_MASKING_RULES;
  const normalizedColumn = columnName.toLowerCase();
  const normalizedValue = typeof value === "string" ? value.trim() : "";
  const categoryEnabled =
    /email/.test(normalizedColumn) || EMAIL.test(normalizedValue)
      ? rules.maskEmail
      : /phone|mobile/.test(normalizedColumn) || PHONE.test(normalizedValue)
        ? rules.maskPhone
        : /national.?id|ssn|tax.?id/.test(normalizedColumn)
          ? rules.maskNationalId
          : /passport/.test(normalizedColumn)
            ? rules.maskPassport !== false
            : /health|medical|diagnos|disease|โรค|สุขภาพ/.test(normalizedColumn)
              ? rules.maskHealth !== false
              : /religion|faith|ศาสนา/.test(normalizedColumn)
                ? rules.maskReligion !== false
                : /biometric|fingerprint|face.?print|iris|ลายนิ้วมือ/.test(
                      normalizedColumn,
                    )
                  ? rules.maskBiometric !== false
                  : /credit.?card|card.?number|cvv|account|iban/.test(
                        normalizedColumn,
                      ) || passesLuhn(normalizedValue)
                    ? rules.maskFinancialAccount
                    : true;
  if (
    options.maskSensitiveData &&
    categoryEnabled &&
    isLikelySensitive(columnName, value)
  )
    return "[MASKED]";
  if (value == null || typeof value === "number" || typeof value === "boolean")
    return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return "[BINARY]";
  const normalized =
    typeof value === "string" ? value : JSON.stringify(value) || String(value);
  return normalized.length > options.maxLength
    ? `${normalized.slice(0, options.maxLength)}…`
    : normalized;
}

export function sanitizeSampleRow(
  row: Record<string, unknown>,
  options: {
    maskSensitiveData: boolean;
    maxLength: number;
    maskingRules?: PiiMaskingRules;
  },
) {
  return Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      sanitizeSampleCell(column, value, options),
    ]),
  );
}
