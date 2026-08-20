import { describe, expect, it } from "vitest";
import { validateGroundedReadOnlySql } from "@/server/connectors/sql-grounding";

const scope = {
  tables: [
    {
      schema: "shop",
      name: "orders",
      kind: "TABLE" as const,
      estimatedRowCount: "50",
      omittedColumnCount: 0,
      sampleRows: [],
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
        },
        {
          name: "customer_id",
          dataType: "int",
          nullable: false,
          primaryKey: false,
        },
        {
          name: "order_total",
          dataType: "decimal(10,2)",
          nullable: false,
          primaryKey: false,
        },
        {
          name: "ordered_at",
          dataType: "datetime",
          nullable: false,
          primaryKey: false,
        },
      ],
    },
    {
      schema: "shop",
      name: "customers",
      kind: "TABLE" as const,
      estimatedRowCount: "10",
      omittedColumnCount: 0,
      sampleRows: [],
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
        },
        {
          name: "region",
          dataType: "varchar(50)",
          nullable: true,
          primaryKey: false,
        },
      ],
    },
  ],
  relationships: [
    {
      name: "orders_customer_fk",
      fromTable: "shop.orders",
      fromColumn: "customer_id",
      toTable: "shop.customers",
      toColumn: "id",
    },
  ],
};

describe("grounded SQL validation", () => {
  it.each([
    "SELECT id, order_total FROM shop.orders",
    "SELECT AVG(TIMESTAMPDIFF(DAY, ordered_at, ordered_at)) AS cycle_days FROM shop.orders",
    "SELECT o.id, c.region FROM shop.orders o JOIN shop.customers c ON c.id = o.customer_id LIMIT 25",
    "SELECT `T1`.id, `T2`.region FROM shop.orders AS `T1` JOIN shop.customers AS `T2` ON `T1`.customer_id = `T2`.id",
    "WITH totals AS (SELECT customer_id, SUM(order_total) AS total FROM shop.orders GROUP BY customer_id) SELECT total FROM totals",
    "SELECT shop.orders.order_total FROM shop.orders",
    "SELECT totals.total FROM (SELECT SUM(order_total) AS total FROM shop.orders) AS totals",
    "WITH totals AS (SELECT SUM(shop.orders.order_total) AS total FROM shop.orders) SELECT totals.total FROM totals",
  ])("accepts approved query: %s", (sql) => {
    const result = validateGroundedReadOnlySql(sql, scope, 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sql).toMatch(/LIMIT/i);
  });

  it.each([
    ["SELECT * FROM shop.payments", "table"],
    ["SELECT password_hash FROM shop.customers", "column"],
    ["SELECT LOAD_FILE(region) FROM shop.customers", "function"],
    [
      "SELECT * FROM shop.orders o JOIN external.inventory i ON i.id = o.id",
      "table",
    ],
  ])("rejects ungrounded %s references", (sql) => {
    expect(validateGroundedReadOnlySql(sql, scope, 100).ok).toBe(false);
  });

  it("caps a larger fixed row limit", () => {
    const result = validateGroundedReadOnlySql(
      "SELECT id FROM shop.orders LIMIT 5000",
      scope,
      100,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sql).toMatch(/LIMIT 100$/i);
  });

  it("rejects joins with no discovered relationship", () => {
    const result = validateGroundedReadOnlySql(
      "SELECT o.id, c.region FROM shop.orders o JOIN shop.customers c ON c.region = o.id",
      { ...scope, relationships: [] },
      100,
    );
    expect(result.ok).toBe(false);
  });

  it("rejects joins that use the wrong columns for a known relationship", () => {
    const result = validateGroundedReadOnlySql(
      "SELECT o.id, c.region FROM shop.orders o JOIN shop.customers c ON c.region = o.id",
      scope,
      100,
    );
    expect(result.ok).toBe(false);
  });

  it("does not treat an interval unit as blanket approval for a column", () => {
    const result = validateGroundedReadOnlySql(
      "SELECT DAY, TIMESTAMPDIFF(DAY, ordered_at, ordered_at) FROM shop.orders",
      scope,
      100,
    );
    expect(result.ok).toBe(false);
  });

  it("still rejects an invalid source column hidden behind a derived table", () => {
    const result = validateGroundedReadOnlySql(
      "SELECT totals.total FROM (SELECT SUM(secret_total) AS total FROM shop.orders) AS totals",
      scope,
      100,
    );
    expect(result.ok).toBe(false);
  });

  it("grounds Oracle tables and columns through an AST before restoring FETCH FIRST", () => {
    const oracleScope = { ...scope, dataSourceType: "ORACLE" as const };
    const valid = validateGroundedReadOnlySql(
      'SELECT "ID", "ORDER_TOTAL" FROM "SHOP"."ORDERS"',
      oracleScope,
      25,
    );
    expect(valid.ok).toBe(true);
    if (valid.ok) expect(valid.data.sql).toMatch(/FETCH FIRST 25 ROWS ONLY/i);
    expect(
      validateGroundedReadOnlySql(
        'SELECT "PASSWORD_HASH" FROM "SHOP"."ORDERS"',
        oracleScope,
        25,
      ).ok,
    ).toBe(false);
  });
});
