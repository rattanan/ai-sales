import { describe, expect, it } from "vitest";
import {
  validateDialectReadOnlySql,
  validateOracleReadOnlySql,
  validateReadOnlySql,
} from "@/server/connectors/sql-guard";

describe("read-only SQL guard", () => {
  it.each([
    "SELECT id, name FROM customers LIMIT 10",
    "WITH recent AS (SELECT id FROM orders) SELECT * FROM recent",
    "SELECT COUNT(*) AS total FROM orders;",
  ])("accepts safe query: %s", (sql) =>
    expect(validateReadOnlySql(sql).ok).toBe(true),
  );

  it.each([
    "DELETE FROM orders",
    "SELECT * FROM users; DROP TABLE users",
    "SELECT * FROM users FOR UPDATE",
    "SELECT * FROM users INTO OUTFILE '/tmp/users'",
    "CALL refresh_dashboard()",
    "nonsense that is not sql",
    "SELECT 1 -- prompt injection\nFROM users",
    "/* prompt injection */ SELECT 1",
  ])("rejects unsafe query: %s", (sql) =>
    expect(validateReadOnlySql(sql).ok).toBe(false),
  );
});

describe("Phase 5 dialect boundaries", () => {
  it.each([
    ["MYSQL", "SELECT id FROM analytics.orders", /LIMIT 25/i],
    ["POSTGRESQL", 'SELECT "id" FROM "analytics"."orders"', /LIMIT 25/i],
    ["MSSQL", "SELECT id FROM analytics.orders", /TOP 25/i],
    [
      "ORACLE",
      'SELECT "ID" FROM "ANALYTICS"."ORDERS"',
      /FETCH FIRST 25 ROWS ONLY/i,
    ],
  ] as const)("adds the hard %s row cap", (dialect, sql, expected) => {
    const result = validateDialectReadOnlySql(sql, dialect, 25);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.sql).toMatch(expected);
  });

  it.each(["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] as const)(
    "rejects adversarial statements for %s",
    (dialect) => {
      for (const sql of [
        "DELETE FROM orders",
        "SELECT * FROM orders; DROP TABLE orders",
        "SELECT * FROM orders FOR UPDATE",
        "SELECT 1 -- bypass",
        "/* bypass */ SELECT 1",
        "EXEC refresh_reporting",
      ])
        expect(validateDialectReadOnlySql(sql, dialect, 100).ok).toBe(false);
    },
  );

  it("blocks dialect-specific file, network, delay, and procedure functions", () => {
    expect(
      validateDialectReadOnlySql("SELECT LOAD_FILE('/etc/passwd')", "MYSQL").ok,
    ).toBe(false);
    expect(
      validateDialectReadOnlySql(
        "SELECT pg_read_file('/etc/passwd')",
        "POSTGRESQL",
      ).ok,
    ).toBe(false);
    expect(
      validateDialectReadOnlySql("SELECT * FROM OPENROWSET(BULK 'x')", "MSSQL")
        .ok,
    ).toBe(false);
    expect(
      validateDialectReadOnlySql(
        "SELECT UTL_HTTP.REQUEST('https://x') FROM dual",
        "ORACLE",
      ).ok,
    ).toBe(false);
  });
});

describe("Oracle read-only SQL guard", () => {
  it.each([
    'SELECT * FROM "REPORTING"."ORDERS" FETCH FIRST 20 ROWS ONLY',
    "WITH totals AS (SELECT 1 AS n FROM dual) SELECT * FROM totals",
  ])("accepts safe query: %s", (sql) =>
    expect(validateOracleReadOnlySql(sql).ok).toBe(true),
  );

  it.each([
    "DELETE FROM orders",
    "BEGIN NULL; END;",
    "SELECT 1 FROM dual; DELETE FROM orders",
    "SELECT 1 -- bypass\n FROM dual",
  ])("rejects unsafe query: %s", (sql) =>
    expect(validateOracleReadOnlySql(sql).ok).toBe(false),
  );
});
