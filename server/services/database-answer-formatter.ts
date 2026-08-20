type PreviewRow = Record<string, unknown>;

type FormattedDatabaseAnswer = {
  summary: string;
  limitations: string[];
};

const DISPLAY_ROW_LIMIT = 10;

function isThai(value: string) {
  return /[ก-๙]/u.test(value);
}

function humanizeFieldName(value: string) {
  return value
    .replace(/^(?:total|count|number|num|sum|avg|average)_/i, "")
    .replace(/_(?:total|count)$/i, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function requestedEntity(question: string, fieldName: string) {
  const thai = question.match(
    /(?:ขอ|หา|แสดง)?\s*จำนวน\s+(.+?)(?=\s+(?:ที่|ทั้งหมด|ในระบบ|ของ)|[?？]|$)/iu,
  )?.[1];
  if (thai?.trim()) return thai.trim();

  const english = question.match(
    /how many\s+(.+?)(?=\s+(?:are|is|exist|exists|in|with)\b|[?？]|$)/iu,
  )?.[1];
  return english?.trim() || humanizeFieldName(fieldName);
}

function numericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value.trim()))
    return Number(value);
  return null;
}

function displayValue(value: unknown, thai: boolean) {
  if (value == null || value === "") return "–";
  const numeric = numericValue(value);
  if (numeric != null)
    return new Intl.NumberFormat(thai ? "th-TH" : "en-US", {
      maximumFractionDigits: 6,
    }).format(numeric);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value)
    .replaceAll("|", "\\|")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function scalarCountSummary(question: string, row: PreviewRow): string | null {
  const entries = Object.entries(row);
  if (entries.length !== 1) return null;
  const [fieldName, rawValue] = entries[0];
  if (!/(?:^|_)(?:total|count|number|num)(?:_|$)/i.test(fieldName)) return null;
  const value = numericValue(rawValue);
  if (value == null) return null;

  const thai = isThai(question);
  const entity = requestedEntity(question, fieldName);
  const formatted = displayValue(value, thai);
  return thai
    ? `พบ ${entity} จำนวน ${formatted} รายการ`
    : `Found ${formatted} ${entity}.`;
}

export function formatDatabaseAnswer(
  question: string,
  previewRows: PreviewRow[],
  rowCount: number,
): FormattedDatabaseAnswer {
  const thai = isThai(question);
  if (!rowCount || !previewRows.length)
    return {
      summary: thai
        ? "ไม่พบข้อมูลที่ตรงกับเงื่อนไข"
        : "No records matched the requested criteria.",
      limitations: [],
    };

  const scalar = scalarCountSummary(question, previewRows[0]);
  if (rowCount === 1 && scalar) return { summary: scalar, limitations: [] };

  const displayRows = previewRows.slice(0, DISPLAY_ROW_LIMIT);
  const columns = Array.from(
    new Set(displayRows.flatMap((row) => Object.keys(row))),
  );
  const title = thai
    ? `พบข้อมูล ${new Intl.NumberFormat("th-TH").format(rowCount)} รายการ`
    : `Found ${new Intl.NumberFormat("en-US").format(rowCount)} records.`;

  if (displayRows.length === 1) {
    const details = columns.map(
      (column) =>
        `- ${humanizeFieldName(column)}: ${displayValue(displayRows[0][column], thai)}`,
    );
    return { summary: [title, "", ...details].join("\n"), limitations: [] };
  }

  const header = `| ${columns.map(humanizeFieldName).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = displayRows.map(
    (row) =>
      `| ${columns.map((column) => displayValue(row[column], thai)).join(" | ")} |`,
  );
  const limitations =
    rowCount > displayRows.length
      ? [
          thai
            ? `แสดงตัวอย่าง ${displayRows.length} จากทั้งหมด ${new Intl.NumberFormat("th-TH").format(rowCount)} รายการ`
            : `Showing ${displayRows.length} of ${new Intl.NumberFormat("en-US").format(rowCount)} records.`,
        ]
      : [];

  return {
    summary: [title, "", header, separator, ...rows].join("\n"),
    limitations,
  };
}
