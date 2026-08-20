import { Parser } from "node-sql-parser";
import type { MetadataContext } from "@/schemas/analysis";
import { failure, success, type AppResult } from "@/types/result";
import {
  validateDialectReadOnlySql,
  validateOracleReadOnlySql,
  type SqlDialect,
} from "./sql-guard";

const parser = new Parser();
const FORBIDDEN_FUNCTIONS = new Set([
  "load_file",
  "sleep",
  "benchmark",
  "get_lock",
  "release_lock",
  "is_free_lock",
  "is_used_lock",
  "master_pos_wait",
]);
const MYSQL_INTERVAL_UNITS = new Set([
  "microsecond",
  "second",
  "minute",
  "hour",
  "day",
  "week",
  "month",
  "quarter",
  "year",
]);

type AstNode = Record<string, unknown>;

function identifierValue(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "value" in value &&
    typeof value.value === "string"
  )
    return value.value;
  return null;
}

function walk(value: unknown, visitor: (node: AstNode) => void) {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visitor);
    return;
  }
  if (!value || typeof value !== "object") return;
  const node = value as AstNode;
  visitor(node);
  for (const nested of Object.values(node)) walk(nested, visitor);
}

function functionName(node: AstNode) {
  if (node.type !== "function") return null;
  const name = node.name as { name?: Array<{ value?: unknown }> } | undefined;
  const value = name?.name?.map((part) => String(part.value ?? "")).join(".");
  return value?.toLowerCase() ?? null;
}

function cteNames(ast: AstNode) {
  const names = new Set<string>();
  const entries = Array.isArray(ast.with) ? ast.with : [];
  for (const entry of entries) {
    const name = (entry as { name?: { value?: unknown } }).name?.value;
    if (name) names.add(String(name).toLowerCase());
  }
  return names;
}

function parsedTableReference(reference: string) {
  const [, owner, name] = reference.split("::");
  return {
    owner: owner === "null" ? null : owner,
    name,
  };
}

function parsedColumnReference(reference: string) {
  const [, ...parts] = reference.split("::");
  const name = parts.at(-1) ?? "";
  const owner = parts.length >= 2 ? parts.at(-2) : null;
  const database = parts.length >= 3 ? parts.at(-3) : null;
  return {
    database: database === "null" ? null : database,
    owner: owner === "null" ? null : owner,
    name,
  };
}

function projectedColumnNames(select: AstNode) {
  const names = new Set<string>();
  const columns = Array.isArray(select.columns) ? select.columns : [];
  for (const value of columns) {
    if (!value || typeof value !== "object") continue;
    const column = value as { as?: unknown; expr?: AstNode };
    const alias = identifierValue(column.as);
    if (alias) {
      names.add(alias.toLowerCase());
      continue;
    }
    if (column.expr?.type !== "column_ref") continue;
    const name = identifierValue(column.expr.column);
    if (name) names.add(name.toLowerCase());
  }
  return names;
}

function virtualRelationColumns(ast: AstNode) {
  const relations = new Map<string, Set<string>>();
  const entries = Array.isArray(ast.with) ? ast.with : [];
  for (const value of entries) {
    if (!value || typeof value !== "object") continue;
    const entry = value as {
      name?: { value?: unknown };
      stmt?: { ast?: AstNode };
    };
    const name = identifierValue(entry.name?.value);
    if (name && entry.stmt?.ast)
      relations.set(name.toLowerCase(), projectedColumnNames(entry.stmt.ast));
  }
  walk(ast, (node) => {
    if (node.type !== "select" || !Array.isArray(node.from)) return;
    for (const value of node.from) {
      if (!value || typeof value !== "object") continue;
      const item = value as { as?: unknown; expr?: { ast?: AstNode } };
      const alias = identifierValue(item.as);
      if (alias && item.expr?.ast)
        relations.set(alias.toLowerCase(), projectedColumnNames(item.expr.ast));
    }
  });
  return relations;
}

function applyRowLimit(ast: AstNode, maxRows: number) {
  const limit = ast.limit as
    { value?: Array<{ type?: string; value?: unknown }> } | null | undefined;
  const current = limit?.value?.[0];
  if (
    current &&
    (current.type !== "number" || !Number.isInteger(Number(current.value)))
  )
    return false;
  if (!current || Number(current.value) > maxRows) {
    ast.limit = {
      seperator: "",
      value: [{ type: "number", value: maxRows }],
    };
  }
  return true;
}

export type GroundedSqlScope = Pick<
  MetadataContext,
  "tables" | "relationships"
> & { dataSourceType?: SqlDialect };

type GroundedSqlValidation = AppResult<{
  sql: string;
  tables: string[];
  columns: string[];
}>;

function parserDatabase(dialect: Exclude<SqlDialect, "ORACLE">) {
  return dialect === "MYSQL"
    ? "MySQL"
    : dialect === "POSTGRESQL"
      ? "Postgresql"
      : "TransactSQL";
}

function applyDialectRowLimit(
  ast: AstNode,
  dialect: Exclude<SqlDialect, "ORACLE">,
  maxRows: number,
) {
  if (dialect !== "MSSQL") return applyRowLimit(ast, maxRows);
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

function validateOracleGroundedReadOnlySql(
  sql: string,
  scope: GroundedSqlScope,
  maxRows: number,
): GroundedSqlValidation {
  const base = validateOracleReadOnlySql(sql, maxRows);
  if (!base.ok) return base;
  const fetch = /\s+fetch\s+first\s+(\d+)\s+rows?\s+only\s*$/i;
  const astInput = base.data.sql.replace(fetch, "");
  const astGrounding = validateGroundedReadOnlySql(
    astInput,
    { ...scope, dataSourceType: "POSTGRESQL" },
    maxRows,
  );
  if (!astGrounding.ok) return astGrounding;
  return success({
    sql: base.data.sql,
    tables: astGrounding.data.tables,
    columns: astGrounding.data.columns,
  });
}

export function validateGroundedReadOnlySql(
  sql: string,
  scope: GroundedSqlScope,
  maxRows: number,
): GroundedSqlValidation {
  if (scope.dataSourceType === "ORACLE")
    return validateOracleGroundedReadOnlySql(sql, scope, maxRows);
  const dialect = scope.dataSourceType ?? "MYSQL";
  const database = parserDatabase(dialect);
  const base = validateDialectReadOnlySql(sql, dialect, maxRows);
  if (!base.ok) return base;
  try {
    const parsed = parser.astify(base.data.sql, { database });
    if (Array.isArray(parsed) || !parsed || parsed.type !== "select")
      return failure(
        "QUERY_VALIDATION_FAILED",
        "The query must contain exactly one read-only SELECT statement.",
      );
    const ast = parsed as unknown as AstNode;
    const ctes = cteNames(ast);
    const virtualColumns = virtualRelationColumns(ast);
    const allowedTables = new Map(
      scope.tables.map((table) => [
        `${table.schema.toLowerCase()}.${table.name.toLowerCase()}`,
        new Set(table.columns.map((column) => column.name.toLowerCase())),
      ]),
    );
    const tablesByName = new Map<string, string[]>();
    for (const fullName of allowedTables.keys()) {
      const name = fullName.split(".").at(-1)!;
      tablesByName.set(name, [...(tablesByName.get(name) ?? []), fullName]);
    }
    const referencedTables = parser
      .tableList(base.data.sql, { database })
      .map(parsedTableReference);
    const physicalReferences: string[] = [];
    for (const reference of referencedTables) {
      const tableName = reference.name.toLowerCase();
      if (!reference.owner && ctes.has(tableName)) continue;
      const resolved = reference.owner
        ? `${reference.owner.toLowerCase()}.${tableName}`
        : tablesByName.get(tableName)?.length === 1
          ? tablesByName.get(tableName)![0]
          : null;
      if (!resolved || !allowedTables.has(resolved))
        return failure(
          "QUERY_VALIDATION_FAILED",
          "The query references a table outside the approved analysis scope.",
          { diagnostics: { invalidTable: reference.name } },
        );
      physicalReferences.push(resolved);
    }

    const allowedColumnNames = new Set(
      [...allowedTables.values()].flatMap((columns) => [...columns]),
    );
    const derivedColumnNames = new Set<string>();
    const intervalUnitReferences = new Map<string, number>();
    const explicitColumnReferences = new Set<string>();
    walk(ast, (node) => {
      if (typeof node.as === "string")
        derivedColumnNames.add(node.as.toLowerCase());
      if (node.type === "origin") {
        const value = String(node.value ?? "").toLowerCase();
        if (MYSQL_INTERVAL_UNITS.has(value))
          intervalUnitReferences.set(
            value,
            (intervalUnitReferences.get(value) ?? 0) + 1,
          );
      }
      if (node.type === "column_ref" && typeof node.column === "string")
        explicitColumnReferences.add(node.column.toLowerCase());
    });
    for (const reference of parser
      .columnList(base.data.sql, { database })
      .map(parsedColumnReference)) {
      const columnName = reference.name.toLowerCase();
      if (columnName === "*") continue;
      const intervalUnitCount = intervalUnitReferences.get(columnName) ?? 0;
      if (
        !reference.owner &&
        intervalUnitCount > 0 &&
        !explicitColumnReferences.has(columnName)
      ) {
        intervalUnitReferences.set(columnName, intervalUnitCount - 1);
        continue;
      }
      if (
        reference.owner &&
        virtualColumns.get(reference.owner.toLowerCase())?.has(columnName)
      )
        continue;
      if (reference.owner) {
        const matchingTables = reference.database
          ? [
              `${reference.database.toLowerCase()}.${reference.owner.toLowerCase()}`,
            ]
          : tablesByName.get(reference.owner.toLowerCase());
        if (
          matchingTables?.some((table) =>
            allowedTables.get(table)?.has(columnName),
          )
        )
          continue;
      } else if (
        allowedColumnNames.has(columnName) ||
        derivedColumnNames.has(columnName)
      )
        continue;
      return failure(
        "QUERY_VALIDATION_FAILED",
        "The query references a column outside the approved analysis scope.",
        { diagnostics: { invalidColumn: reference.name } },
      );
    }

    let forbiddenFunction: string | null = null;
    walk(ast, (node) => {
      const name = functionName(node);
      if (name && FORBIDDEN_FUNCTIONS.has(name)) forbiddenFunction = name;
    });
    if (forbiddenFunction)
      return failure(
        "QUERY_VALIDATION_FAILED",
        "The query uses a function that is not allowed for dashboard analysis.",
        { diagnostics: { invalidFunction: forbiddenFunction } },
      );

    const uniqueTables = [...new Set(physicalReferences)];
    const allowedJoinKeys = new Set(
      scope.relationships.flatMap((relationship) => [
        `${relationship.fromTable.toLowerCase()}.${relationship.fromColumn.toLowerCase()}::${relationship.toTable.toLowerCase()}.${relationship.toColumn.toLowerCase()}`,
        `${relationship.toTable.toLowerCase()}.${relationship.toColumn.toLowerCase()}::${relationship.fromTable.toLowerCase()}.${relationship.fromColumn.toLowerCase()}`,
      ]),
    );
    let invalidJoin = false;
    walk(ast, (node) => {
      if (node.type !== "select" || !Array.isArray(node.from)) return;
      const from = node.from as Array<{
        db?: unknown;
        table?: unknown;
        as?: unknown;
        join?: string;
        on?: unknown;
      }>;
      const aliases = new Map<string, string>();
      for (const item of from) {
        const table = identifierValue(item.table);
        if (!table) continue;
        const tableName = table.toLowerCase();
        const database = identifierValue(item.db);
        const resolved = database
          ? `${database.toLowerCase()}.${tableName}`
          : tablesByName.get(tableName)?.length === 1
            ? tablesByName.get(tableName)![0]
            : null;
        if (!resolved || !allowedTables.has(resolved)) continue;
        aliases.set(tableName, resolved);
        const alias = identifierValue(item.as);
        if (alias) aliases.set(alias.toLowerCase(), resolved);
      }
      for (const item of from.filter((entry) => entry.join && entry.on)) {
        let matchedRelationship = false;
        walk(item.on, (expression) => {
          if (expression.type !== "binary_expr" || expression.operator !== "=")
            return;
          const left = expression.left as
            { type?: string; table?: unknown; column?: unknown } | undefined;
          const right = expression.right as
            { type?: string; table?: unknown; column?: unknown } | undefined;
          const leftTableName = identifierValue(left?.table);
          const rightTableName = identifierValue(right?.table);
          const leftColumn = identifierValue(left?.column);
          const rightColumn = identifierValue(right?.column);
          if (
            left?.type !== "column_ref" ||
            right?.type !== "column_ref" ||
            !leftTableName ||
            !rightTableName ||
            !leftColumn ||
            !rightColumn
          )
            return;
          const leftTable = aliases.get(leftTableName.toLowerCase());
          const rightTable = aliases.get(rightTableName.toLowerCase());
          if (!leftTable || !rightTable) return;
          if (
            allowedJoinKeys.has(
              `${leftTable}.${leftColumn.toLowerCase()}::${rightTable}.${rightColumn.toLowerCase()}`,
            )
          )
            matchedRelationship = true;
        });
        const joinedIdentifier = identifierValue(item.as ?? item.table);
        const joinedTable = joinedIdentifier
          ? aliases.get(joinedIdentifier.toLowerCase())
          : null;
        if (joinedTable && !matchedRelationship) invalidJoin = true;
      }
    });
    if (invalidJoin)
      return failure(
        "QUERY_VALIDATION_FAILED",
        "The query join does not use an approved discovered relationship.",
      );
    if (uniqueTables.length > 1) {
      const allowedPairs = new Set(
        scope.relationships.flatMap((relationship) => [
          `${relationship.fromTable.toLowerCase()}::${relationship.toTable.toLowerCase()}`,
          `${relationship.toTable.toLowerCase()}::${relationship.fromTable.toLowerCase()}`,
        ]),
      );
      for (let index = 1; index < uniqueTables.length; index++) {
        const connected = uniqueTables
          .slice(0, index)
          .some((previous) =>
            allowedPairs.has(`${previous}::${uniqueTables[index]}`),
          );
        if (!connected)
          return failure(
            "QUERY_VALIDATION_FAILED",
            "The query joins tables without an approved discovered relationship.",
          );
      }
    }

    if (!applyDialectRowLimit(ast, dialect, maxRows))
      return failure(
        "QUERY_VALIDATION_FAILED",
        "The query row limit must be a fixed number.",
      );
    const guardedSql = parser.sqlify(ast as never, { database });
    return success({
      sql: guardedSql,
      tables: uniqueTables,
      columns: parser.columnList(base.data.sql, { database }),
    });
  } catch {
    return failure(
      "QUERY_VALIDATION_FAILED",
      "The query could not be grounded against the approved metadata.",
    );
  }
}
