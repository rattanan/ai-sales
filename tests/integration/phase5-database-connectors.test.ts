import { describe, expect, it } from "vitest";
import { PostgreSqlConnector } from "@/server/connectors/postgresql";
import { MsSqlConnector } from "@/server/connectors/mssql";
import { OracleConnector } from "@/server/connectors/oracle";

describe.skipIf(!process.env.TEST_POSTGRES_HOST)(
  "PostgreSQL connector fixture",
  () => {
    it("tests, discovers, and executes only a bounded read-only query", async () => {
      const database = process.env.TEST_POSTGRES_DATABASE ?? "postgres";
      const schema = process.env.TEST_POSTGRES_SCHEMA ?? "public";
      const connector = new PostgreSqlConnector({
        host: process.env.TEST_POSTGRES_HOST,
        port: Number(process.env.TEST_POSTGRES_PORT ?? 5432),
        databaseName: database,
        username: process.env.TEST_POSTGRES_USER,
        password: process.env.TEST_POSTGRES_PASSWORD,
        sslEnabled: process.env.TEST_POSTGRES_SSL === "true",
        connectionOptions: {},
      });
      try {
        expect((await connector.testConnection()).ok).toBe(true);
        expect((await connector.listSchemas()).ok).toBe(true);
        expect((await connector.listTables([schema])).ok).toBe(true);
        const result = await connector.executeReadOnlyQuery(
          "SELECT 1 AS fixture_value",
          {
            timeoutMs: 5_000,
            maxRows: 10,
          },
        );
        expect(result.ok).toBe(true);
        expect(
          (await connector.executeReadOnlyQuery("DROP TABLE unsafe_fixture"))
            .ok,
        ).toBe(false);
      } finally {
        await connector.close();
      }
    });
  },
);

describe.skipIf(!process.env.TEST_MSSQL_HOST)(
  "SQL Server connector fixture",
  () => {
    it("tests and executes a bounded read-only query", async () => {
      const connector = new MsSqlConnector({
        host: process.env.TEST_MSSQL_HOST,
        port: Number(process.env.TEST_MSSQL_PORT ?? 1433),
        databaseName: process.env.TEST_MSSQL_DATABASE ?? "master",
        username: process.env.TEST_MSSQL_USER,
        password: process.env.TEST_MSSQL_PASSWORD,
        sslEnabled: process.env.TEST_MSSQL_SSL !== "false",
        connectionOptions: {
          trustServerCertificate: process.env.TEST_MSSQL_TRUST_CERT === "true",
        },
      });
      try {
        expect((await connector.testConnection()).ok).toBe(true);
        expect(
          (
            await connector.executeReadOnlyQuery("SELECT 1 AS fixture_value", {
              maxRows: 10,
            })
          ).ok,
        ).toBe(true);
        expect((await connector.executeReadOnlyQuery("EXEC sp_who")).ok).toBe(
          false,
        );
      } finally {
        await connector.close();
      }
    });
  },
);

describe.skipIf(!process.env.TEST_ORACLE_HOST)(
  "Oracle connector fixture",
  () => {
    it("tests and executes a bounded read-only query", async () => {
      const connector = new OracleConnector({
        host: process.env.TEST_ORACLE_HOST,
        port: Number(process.env.TEST_ORACLE_PORT ?? 1521),
        databaseName: process.env.TEST_ORACLE_SERVICE ?? "FREEPDB1",
        username: process.env.TEST_ORACLE_USER,
        password: process.env.TEST_ORACLE_PASSWORD,
        sslEnabled: process.env.TEST_ORACLE_SSL === "true",
        connectionOptions: {},
        oracle: {
          connectionType: "service_name",
          serviceName: process.env.TEST_ORACLE_SERVICE ?? "FREEPDB1",
          sslMode:
            process.env.TEST_ORACLE_SSL === "true" ? "require" : "disable",
          connectionTimeoutMs: 5_000,
        },
      });
      try {
        expect((await connector.testConnection()).ok).toBe(true);
        expect(
          (
            await connector.executeReadOnlyQuery(
              "SELECT 1 AS fixture_value FROM dual",
              { maxRows: 10 },
            )
          ).ok,
        ).toBe(true);
        expect(
          (await connector.executeReadOnlyQuery("BEGIN NULL; END;")).ok,
        ).toBe(false);
      } finally {
        await connector.close();
      }
    });
  },
);
