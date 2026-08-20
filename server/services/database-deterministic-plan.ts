import type { DatabaseQueryPlan } from "@/schemas/database-intelligence";

type DatabaseSourceType = "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE";

type TextSearchMetadata = {
  dataSourceType: DatabaseSourceType;
  tables: Array<{
    schema: string;
    name: string;
    columns: Array<{ name: string }>;
  }>;
};

const workOrderTableAliases = new Set([
  "work_order",
  "work_orders",
  "workorder",
  "workorders",
  "woord010",
]);
const assetTableAliases = new Set(["asset", "assets", "asast010"]);

const descriptionAliases = new Set([
  "description",
  "desc",
  "dsca",
  "desp",
  "details",
  "detail",
  "comment",
  "note",
]);

function quotedIdentifier(value: string, dialect: DatabaseSourceType) {
  if (dialect === "MYSQL") return `\`${value.replaceAll("`", "``")}\``;
  if (dialect === "MSSQL") return `[${value.replaceAll("]", "]]")}]`;
  return `"${value.replaceAll('"', '""')}"`;
}

function searchTerm(question: string) {
  return question.match(
    /(?:เกี่ยวกับ|มีคำว่า|ประกอบด้วย|containing|contains|about|matching|like)\s*["“”']?([\p{L}\p{N}_-]{2,100})/iu,
  )?.[1];
}

function limitedSelectKeyword(dialect: DatabaseSourceType, limit: number) {
  return dialect === "MSSQL" ? `SELECT TOP ${limit}` : "SELECT";
}

function rowLimit(dialect: DatabaseSourceType, limit: number) {
  if (dialect === "ORACLE") return ` FETCH FIRST ${limit} ROWS ONLY`;
  if (dialect === "MSSQL") return "";
  return ` LIMIT ${limit}`;
}

function planLongestOpenWorkOrder(
  question: string,
  metadata: TextSearchMetadata,
): DatabaseQueryPlan | null {
  if (
    !/\bwork\s*orders?\b/iu.test(question) ||
    !/\b(?:open\s+(?:the\s+)?longest|longest\s+open|oldest\s+open)\b/iu.test(
      question,
    )
  )
    return null;

  const table = metadata.tables.find((candidate) =>
    workOrderTableAliases.has(candidate.name.toLocaleLowerCase()),
  );
  if (!table) return null;
  const columns = new Map(
    table.columns.map((column) => [column.name.toLocaleLowerCase(), column]),
  );
  const status = columns.get("status") ?? columns.get("stat");
  const created =
    columns.get("created_at") ??
    columns.get("created_date") ??
    columns.get("crdt") ??
    columns.get("opened_at") ??
    columns.get("open_date");
  if (!status || !created) return null;

  const outputAliases = [
    "id",
    "code",
    "name",
    "description",
    "dsca",
    status.name.toLocaleLowerCase(),
    "type",
    "nfdt",
    "dudt",
    created.name.toLocaleLowerCase(),
  ];
  const selected = Array.from(new Set(outputAliases))
    .map((name) => columns.get(name))
    .filter((column): column is { name: string } => Boolean(column));
  const dialect = metadata.dataSourceType;
  const tableName = `${quotedIdentifier(table.schema, dialect)}.${quotedIdentifier(table.name, dialect)}`;
  const statusName = quotedIdentifier(status.name, dialect);
  const createdName = quotedIdentifier(created.name, dialect);

  return {
    intent: "DATABASE",
    clarification: null,
    sql: `${limitedSelectKeyword(dialect, 1)} ${selected.map((column) => quotedIdentifier(column.name, dialect)).join(", ")} FROM ${tableName} WHERE LOWER(${statusName}) = 'open' AND ${createdName} IS NOT NULL ORDER BY ${createdName} ASC${rowLimit(dialect, 1)}`,
    explanation: `Find the oldest ${table.schema}.${table.name} record whose ${status.name} is Open, ordered by ${created.name}.`,
    referencedTables: [`${table.schema}.${table.name}`],
  };
}

export function planDeterministicDatabaseQuery(
  question: string,
  metadata: TextSearchMetadata,
) {
  return (
    planLongestOpenWorkOrder(question, metadata) ??
    planDeterministicDatabaseTextSearch(question, metadata)
  );
}

export function planDeterministicDatabaseTextSearch(
  question: string,
  metadata: TextSearchMetadata,
): DatabaseQueryPlan | null {
  if (!/\b(description|desc)\b|คำอธิบาย/iu.test(question)) return null;
  const term = searchTerm(question);
  if (!term) return null;

  const candidates = metadata.tables.filter((table) =>
    table.columns.some((column) =>
      descriptionAliases.has(column.name.toLocaleLowerCase()),
    ),
  );
  const table =
    candidates.length === 1
      ? candidates[0]
      : /\bassets?\b/iu.test(question)
        ? candidates.find((candidate) =>
            assetTableAliases.has(candidate.name.toLocaleLowerCase()),
          )
        : undefined;
  if (!table) return null;
  const searchColumn = table.columns.find((column) =>
    descriptionAliases.has(column.name.toLocaleLowerCase()),
  );
  if (!searchColumn) return null;

  const preferredOutput = new Set(["id", "code", "name"]);
  const outputColumns = table.columns.filter(
    (column) =>
      preferredOutput.has(column.name.toLocaleLowerCase()) ||
      column.name === searchColumn.name,
  );
  const dialect = metadata.dataSourceType;
  const select = outputColumns
    .map((column) => quotedIdentifier(column.name, dialect))
    .join(", ");
  const tableName = `${quotedIdentifier(table.schema, dialect)}.${quotedIdentifier(table.name, dialect)}`;
  const columnName = quotedIdentifier(searchColumn.name, dialect);
  const escapedTerm = term.replaceAll("'", "''").toLocaleLowerCase();
  const selectKeyword = limitedSelectKeyword(dialect, 200);

  return {
    intent: "DATABASE",
    clarification: null,
    sql: `${selectKeyword} ${select} FROM ${tableName} WHERE LOWER(${columnName}) LIKE '%${escapedTerm}%'${rowLimit(dialect, 200)}`,
    explanation: `Search ${table.schema}.${table.name}.${searchColumn.name} for text containing the requested term.`,
    referencedTables: [`${table.schema}.${table.name}`],
  };
}
