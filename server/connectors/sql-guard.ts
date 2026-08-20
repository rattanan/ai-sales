import { Parser } from "node-sql-parser";
import { failure, success, type AppResult } from "@/types/result";

export type SqlDialect = "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE";

const parser = new Parser();
const BASE_FORBIDDEN =
  /\b(insert|update|delete|replace|merge|drop|alter|truncate|create|grant|revoke|execute|exec|call|copy|load\s+data|into\s+(out|dump)file|select\s+.*\s+into\s+|for\s+update|lock\s+in\s+share\s+mode|commit|rollback|savepoint|set\s+(?:role|session|transaction))\b/i;

const DIALECT_FORBIDDEN: Record<SqlDialect, RegExp> = {
  MYSQL:
    /\b(load_file|sleep|benchmark|get_lock|release_lock|is_free_lock|is_used_lock|master_pos_wait)\s*\(/i,
  POSTGRESQL:
    /\b(pg_read_file|pg_read_binary_file|pg_ls_dir|pg_sleep|lo_import|lo_export|dblink|dblink_exec|query_to_xml|database_to_xml)\s*\(/i,
  MSSQL:
    /\b(openrowset|opendatasource|openquery|bulk|waitfor|xp_[a-z0-9_]+|sp_[a-z0-9_]+)\b/i,
  ORACLE: /\b(utl_[a-z0-9_]+|dbms_[a-z0-9_]+|owa_[a-z0-9_]+|java|external)\b/i,
};

function parserDialect(dialect: Exclude<SqlDialect, "ORACLE">) {
  return dialect === "MYSQL"
    ? "MySQL"
    : dialect === "POSTGRESQL"
      ? "Postgresql"
      : "TransactSQL";
}

function boundedRows(value: number) {
  return Math.min(Math.max(Math.floor(value), 1), 10_000);
}

function normalizeSql(sql: string) {
  const trimmed = sql.trim();
  if (!trimmed || trimmed.length > 100_000) return null;
  if (/\/\*|\*\/|--|#(?!>)/.test(trimmed)) return null;
  const withoutTerminator = trimmed.replace(/;\s*$/, "");
  if (/;/.test(withoutTerminator)) return null;
  return withoutTerminator;
}

function enforceAstLimit(
  ast: Record<string, unknown>,
  dialect: Exclude<SqlDialect, "ORACLE">,
  maxRows: number,
) {
  if (dialect === "MSSQL") {
    const top = ast.top as { value?: unknown; percent?: unknown } | null;
    if (
      top?.percent ||
      (top?.value != null && !Number.isInteger(Number(top.value)))
    )
      return false;
    if (!top || Number(top.value) > maxRows)
      ast.top = { value: maxRows, percent: null };
    return true;
  }
  const limit = ast.limit as
    { value?: Array<{ type?: string; value?: unknown }> } | null | undefined;
  const current = limit?.value?.[0];
  if (
    current &&
    (current.type !== "number" || !Number.isInteger(Number(current.value)))
  )
    return false;
  if (!current || Number(current.value) > maxRows)
    ast.limit = {
      seperator: "",
      value: [{ type: "number", value: maxRows }],
    };
  return true;
}

function validateOracle(sql: string, maxRows: number) {
  const normalized = normalizeSql(sql);
  if (
    !normalized ||
    !/^(select|with)\b/i.test(normalized) ||
    BASE_FORBIDDEN.test(normalized) ||
    DIALECT_FORBIDDEN.ORACLE.test(normalized)
  )
    return failure(
      "UNSAFE_QUERY",
      "Only one bounded, read-only Oracle SELECT or WITH query is allowed.",
    );
  const fetch = /\s+fetch\s+first\s+(\d+)\s+rows?\s+only\s*$/i;
  const existing = normalized.match(fetch);
  const bounded = existing
    ? normalized.replace(
        fetch,
        ` FETCH FIRST ${Math.min(Number(existing[1]), maxRows)} ROWS ONLY`,
      )
    : `${normalized} FETCH FIRST ${maxRows} ROWS ONLY`;
  return success({ sql: bounded });
}

export function validateDialectReadOnlySql(
  sql: string,
  dialect: SqlDialect,
  maxRows = 1_000,
): AppResult<{ sql: string }> {
  const limit = boundedRows(maxRows);
  if (dialect === "ORACLE") return validateOracle(sql, limit);
  const normalized = normalizeSql(sql);
  if (
    !normalized ||
    BASE_FORBIDDEN.test(normalized) ||
    DIALECT_FORBIDDEN[dialect].test(normalized)
  )
    return failure(
      "UNSAFE_QUERY",
      "Only one bounded, read-only SELECT or WITH query is allowed.",
    );
  try {
    const database = parserDialect(dialect);
    const parsed = parser.astify(normalized, { database });
    if (Array.isArray(parsed) || !parsed || parsed.type !== "select")
      return failure(
        "UNSAFE_QUERY",
        "Only one bounded, read-only SELECT or WITH query is allowed.",
      );
    const ast = parsed as unknown as Record<string, unknown>;
    if (!enforceAstLimit(ast, dialect, limit))
      return failure("UNSAFE_QUERY", "The row limit must be a fixed number.");
    return success({ sql: parser.sqlify(ast as never, { database }) });
  } catch {
    return failure(
      "UNSAFE_QUERY",
      "The query could not be parsed as a safe read-only statement.",
    );
  }
}

export function validateReadOnlySql(sql: string, maxRows = 1_000) {
  return validateDialectReadOnlySql(sql, "MYSQL", maxRows);
}

export function validatePostgreSqlReadOnlySql(sql: string, maxRows = 1_000) {
  return validateDialectReadOnlySql(sql, "POSTGRESQL", maxRows);
}

export function validateMsSqlReadOnlySql(sql: string, maxRows = 1_000) {
  return validateDialectReadOnlySql(sql, "MSSQL", maxRows);
}

export function validateOracleReadOnlySql(sql: string, maxRows = 1_000) {
  return validateDialectReadOnlySql(sql, "ORACLE", maxRows);
}
