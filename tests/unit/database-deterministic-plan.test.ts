import { describe, expect, it } from "vitest";
import { planDeterministicDatabaseTextSearch } from "@/server/services/database-deterministic-plan";
import { planDeterministicDatabaseQuery } from "@/server/services/database-deterministic-plan";
import { validateGroundedReadOnlySql } from "@/server/connectors/sql-grounding";

const metadata = {
  dataSourceType: "MYSQL" as const,
  tables: [
    {
      schema: "nexif",
      name: "asast010",
      columns: [
        { name: "id" },
        { name: "code" },
        { name: "name" },
        { name: "dsca" },
      ],
    },
  ],
};

describe("planDeterministicDatabaseTextSearch", () => {
  it("builds a bounded read-only description search from approved metadata", () => {
    const plan = planDeterministicDatabaseTextSearch(
      "ช่วยหา asset ที่มี description เกี่ยวกับ filter",
      metadata,
    );
    expect(plan).toMatchObject({
      intent: "DATABASE",
      sql: "SELECT `id`, `code`, `name`, `dsca` FROM `nexif`.`asast010` WHERE LOWER(`dsca`) LIKE '%filter%' LIMIT 200",
      referencedTables: ["nexif.asast010"],
    });
    expect(
      validateGroundedReadOnlySql(
        plan?.sql ?? "",
        {
          dataSourceType: "MYSQL",
          tables: [
            {
              schema: "nexif",
              name: "asast010",
              kind: "TABLE",
              estimatedRowCount: null,
              columns: metadata.tables[0].columns.map((column, ordinal) => ({
                ...column,
                dataType: "varchar(255)",
                nullable: true,
                primaryKey: false,
                ordinal,
              })),
              omittedColumnCount: 0,
              sampleRows: [],
            },
          ],
          relationships: [],
        },
        200,
      ).ok,
    ).toBe(true);
  });

  it("does not guess when the request or metadata is ambiguous", () => {
    expect(
      planDeterministicDatabaseTextSearch("สรุปนโยบายวันลา", metadata),
    ).toBeNull();
    expect(
      planDeterministicDatabaseTextSearch(
        "Find description containing filter",
        { ...metadata, tables: [...metadata.tables, ...metadata.tables] },
      ),
    ).toBeNull();
  });

  it("selects the asset table when multiple description tables are authorized", () => {
    const plan = planDeterministicDatabaseTextSearch(
      "ช่วยหา asset ที่มี description เกี่ยวกับ filter",
      {
        ...metadata,
        tables: [
          ...metadata.tables,
          {
            schema: "nexif",
            name: "woord010",
            columns: [{ name: "id" }, { name: "dsca" }],
          },
        ],
      },
    );

    expect(plan?.referencedTables).toEqual(["nexif.asast010"]);
  });
});

describe("planDeterministicDatabaseQuery", () => {
  it("finds the oldest open Work Order from authorized metadata", () => {
    const workOrderMetadata = {
      dataSourceType: "MYSQL" as const,
      tables: [
        ...metadata.tables,
        {
          schema: "nexif",
          name: "woord010",
          columns: [
            { name: "id" },
            { name: "code" },
            { name: "dsca" },
            { name: "stat" },
            { name: "type" },
            { name: "nfdt" },
            { name: "dudt" },
            { name: "crdt" },
          ],
        },
      ],
    };

    const plan = planDeterministicDatabaseQuery(
      "find the work order that has been open the longest",
      workOrderMetadata,
    );

    expect(plan).toMatchObject({
      intent: "DATABASE",
      referencedTables: ["nexif.woord010"],
      sql: "SELECT `id`, `code`, `dsca`, `stat`, `type`, `nfdt`, `dudt`, `crdt` FROM `nexif`.`woord010` WHERE LOWER(`stat`) = 'open' AND `crdt` IS NOT NULL ORDER BY `crdt` ASC LIMIT 1",
    });
  });

  it("does not guess without status and created-date columns", () => {
    expect(
      planDeterministicDatabaseQuery(
        "find the work order that has been open the longest",
        metadata,
      ),
    ).toBeNull();
  });
});
