import { describe, expect, it } from "vitest";
import {
  buildMetadataContext,
  type MetadataContextInput,
  type MetadataContextLimits,
} from "@/server/services/metadata-context";
import {
  isLikelySensitive,
  sanitizeSampleCell,
} from "@/server/services/sensitive-data";
import { success } from "@/types/result";

const limits: MetadataContextLimits = {
  maxTables: 2,
  maxColumnsPerTable: 2,
  sampleRowsPerTable: 2,
  maxSampleCellLength: 12,
  maxContextCharacters: 20_000,
  sendSampleData: true,
  maskSensitiveData: true,
};

const input: MetadataContextInput = {
  dataSourceName: "Commerce",
  tables: [
    {
      id: "customers",
      schema: "shop",
      name: "customers",
      kind: "TABLE",
      estimatedRowCount: 10n,
      sampleDataEnabled: true,
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
          ordinal: 1,
        },
        {
          name: "email",
          dataType: "varchar(255)",
          nullable: false,
          primaryKey: false,
          ordinal: 2,
        },
      ],
    },
    {
      id: "orders",
      schema: "shop",
      name: "orders",
      kind: "TABLE",
      estimatedRowCount: 50n,
      sampleDataEnabled: true,
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
          ordinal: 1,
        },
        {
          name: "customer_id",
          dataType: "int",
          nullable: false,
          primaryKey: false,
          ordinal: 2,
        },
        {
          name: "order_total",
          dataType: "decimal(10,2)",
          nullable: false,
          primaryKey: false,
          ordinal: 3,
        },
      ],
    },
    {
      id: "logs",
      schema: "shop",
      name: "internal_logs",
      kind: "TABLE",
      estimatedRowCount: null,
      columns: [
        {
          name: "message",
          dataType: "text",
          nullable: true,
          primaryKey: false,
          ordinal: 1,
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
  businessObjective: {
    area: "Commerce",
    objective: "Analyze order totals and customer activity.",
    questions: null,
    desiredKpis: "Order revenue",
    targetAudience: "Operations",
    reportingPeriod: null,
    importantFilters: null,
  },
  dashboardPreferences: {
    layout: "EXECUTIVE_OVERVIEW",
    visualStyle: "CLEAN_PROFESSIONAL",
    theme: "BLUE",
  },
};

describe("metadata context builder", () => {
  it("ranks relevant connected tables and reports every reduction", async () => {
    const result = await buildMetadataContext(input, limits, async (table) =>
      success(
        table.name === "customers"
          ? [{ id: 1, email: "person@example.com" }]
          : [{ id: 1, customer_id: 1, order_total: "123.45" }],
      ),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.context.tables.map((table) => table.name)).toEqual([
      "orders",
      "customers",
    ]);
    expect(result.data.context.scopeReduction.omittedTables).toEqual([
      "shop.internal_logs",
    ]);
    expect(result.data.context.scopeReduction.omittedColumns).toEqual([
      { table: "shop.orders", count: 1 },
    ]);
    expect(result.data.context.tables[1].sampleRows[0].email).toBe("[MASKED]");
    expect(result.data.context.relationships).toHaveLength(1);
  });

  it("produces a stable hash for the same deterministic context", async () => {
    const metadataOnly = { ...limits, sendSampleData: false };
    const first = await buildMetadataContext(input, metadataOnly);
    const second = await buildMetadataContext(input, metadataOnly);
    expect(first.ok && second.ok && first.data.hash).toBe(
      second.ok ? second.data.hash : "",
    );
    if (!first.ok) return;
    expect(first.data.context.scopeReduction.warnings).toContain(
      "Sample data is disabled; analysis uses metadata only.",
    );
  });
});

describe("sensitive sample masking", () => {
  it.each([
    ["email", "person@example.com"],
    ["value", "4111 1111 1111 1111"],
    ["api_token", "short"],
    ["value", "opaque_identifier_1234567890abcdef"],
  ])("detects sensitive %s values", (column, value) => {
    expect(isLikelySensitive(column, value)).toBe(true);
  });

  it("truncates ordinary long sample text", () => {
    expect(
      sanitizeSampleCell("description", "abcdefghijklmnop", {
        maskSensitiveData: true,
        maxLength: 8,
      }),
    ).toBe("abcdefgh…");
  });

  it("honors tenant masking categories while always protecting credentials", () => {
    const options = {
      maskSensitiveData: true,
      maxLength: 100,
      maskingRules: {
        maskEmail: false,
        maskPhone: true,
        maskNationalId: true,
        maskFinancialAccount: true,
      },
    };
    expect(sanitizeSampleCell("email", "person@example.com", options)).toBe(
      "person@example.com",
    );
    expect(sanitizeSampleCell("phone", "+66 81 234 5678", options)).toBe(
      "[MASKED]",
    );
    expect(sanitizeSampleCell("api_token", "short", options)).toBe("[MASKED]");
  });
});
