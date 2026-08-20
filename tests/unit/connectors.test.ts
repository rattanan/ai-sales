import { describe, expect, it, vi } from "vitest";
import { createConnector } from "@/server/connectors/factory";
import { MySqlConnector } from "@/server/connectors/mysql";
import { PostgreSqlConnector } from "@/server/connectors/postgresql";
import { MsSqlConnector } from "@/server/connectors/mssql";
import { OracleConnector } from "@/server/connectors/oracle";
import { ExcelUploadService } from "@/server/services/excel";

describe("connector boundaries", () => {
  it("creates the live MySQL adapter", () => {
    expect(createConnector("MYSQL", {})).toBeInstanceOf(MySqlConnector);
  });
  it("validates saved connector fields without requiring a wizard name", () => {
    const connector = new MySqlConnector({
      host: "127.0.0.1",
      port: 3306,
      databaseName: "analytics",
      username: "reader",
      password: "secret",
      sslEnabled: false,
      connectionOptions: {},
    });
    expect(connector.validateConfiguration().ok).toBe(true);
  });
  it("returns safe field diagnostics for incomplete connector settings", () => {
    const result = new MySqlConnector({}).validateConfiguration();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.diagnostics?.invalidFields).toContain("host");
      expect(JSON.stringify(result.error)).not.toContain('password":"');
    }
  });
  it("creates every Phase 5 database adapter", () => {
    expect(createConnector("POSTGRESQL", {})).toBeInstanceOf(
      PostgreSqlConnector,
    );
    expect(createConnector("MSSQL", {})).toBeInstanceOf(MsSqlConnector);
    expect(createConnector("ORACLE", {})).toBeInstanceOf(OracleConnector);
  });
  it.each(["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] as const)(
    "%s implements the cancellable read-only connector contract",
    (type) => {
      const connector = createConnector(type, {});
      for (const method of [
        "validateConfiguration",
        "testConnection",
        "listSchemas",
        "listTables",
        "listColumns",
        "listRelationships",
        "fetchSample",
        "executeReadOnlyQuery",
        "cancelActiveQuery",
        "close",
      ] as const)
        expect(typeof connector[method]).toBe("function");
    },
  );
  it("validates PostgreSQL and SQL Server configuration without leaking secrets", () => {
    for (const connector of [
      new PostgreSqlConnector({}),
      new MsSqlConnector({}),
    ]) {
      const result = connector.validateConfiguration();
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).not.toMatch(
        /password["']?\s*:\s*["'][^"']+/i,
      );
    }
  });
  it("rejects invalid Excel extensions before storage", async () => {
    const storage = { put: vi.fn(), get: vi.fn(), delete: vi.fn() };
    const result = await new ExcelUploadService(storage).upload(
      new File(["text"], "notes.txt", { type: "text/plain" }),
    );
    expect(result.ok).toBe(false);
    expect(storage.put).not.toHaveBeenCalled();
  });
});
