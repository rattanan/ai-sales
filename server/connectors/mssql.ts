import sql from "mssql";
import { z } from "zod";
import { logger } from "@/server/services/logger";
import { failure, success, type AppResult } from "@/types/result";
import { validateMsSqlReadOnlySql } from "./sql-guard";
import type {
  ConnectorConfiguration,
  DataConnector,
  DiscoveredColumn,
  DiscoveredRelationship,
  DiscoveredSchema,
  DiscoveredTable,
} from "./types";

const configurationSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65_535),
  databaseName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  sslEnabled: z.boolean().optional().default(true),
  connectionOptions: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .default({}),
});

function quoteIdentifier(value: string) {
  return "[" + value.replaceAll("]", "]]") + "]";
}

function safeFailure(error: unknown, operation: string) {
  const requestId = crypto.randomUUID();
  const source =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code = typeof source.code === "string" ? source.code : "UNKNOWN";
  logger.error("SQL Server connector operation failed", {
    requestId,
    operation,
    diagnostics: { driverCode: code },
  });
  const messages: Record<string, string> = {
    ELOGIN: "SQL Server rejected the username or password.",
    ESOCKET: "The SQL Server host could not be reached.",
    ETIMEOUT: "The SQL Server operation timed out.",
    ECANCEL: "The SQL Server query was cancelled.",
  };
  return failure(
    "CONNECTION_FAILED",
    messages[code] ?? "The SQL Server operation could not be completed.",
    {
      requestId,
      diagnostics: { operation, driverCode: code },
    },
  );
}

export class MsSqlConnector implements DataConnector {
  private connection?: sql.ConnectionPool;
  private activeRequest?: sql.Request;

  constructor(private readonly configuration: ConnectorConfiguration) {}

  validateConfiguration(): AppResult<{ valid: true }> {
    const parsed = configurationSchema.safeParse(this.configuration);
    return parsed.success
      ? success({ valid: true })
      : failure(
          "VALIDATION_ERROR",
          "The SQL Server connection configuration is incomplete.",
          {
            fieldErrors: parsed.error.flatten().fieldErrors,
          },
        );
  }

  private parsed() {
    return configurationSchema.parse(this.configuration);
  }

  private async pool() {
    if (this.connection?.connected) return this.connection;
    const value = this.parsed();
    this.connection = await new sql.ConnectionPool({
      server: value.host,
      port: value.port,
      database: value.databaseName,
      user: value.username,
      password: value.password,
      connectionTimeout: Math.min(
        Number(value.connectionOptions.connectionTimeoutMs ?? 15_000),
        60_000,
      ),
      requestTimeout: 30_000,
      pool: { min: 0, max: 5, idleTimeoutMillis: 30_000 },
      options: {
        encrypt: value.sslEnabled,
        trustServerCertificate:
          value.connectionOptions.trustServerCertificate === true,
        enableArithAbort: true,
      },
    }).connect();
    return this.connection;
  }

  private async query<T extends Record<string, unknown>>(
    operation: string,
    statement: string,
  ) {
    try {
      const result = await (await this.pool()).request().query<T>(statement);
      return success(result.recordset ?? []);
    } catch (error) {
      return safeFailure(error, operation);
    }
  }

  async testConnection() {
    const validation = this.validateConfiguration();
    if (!validation.ok) return validation;
    const started = performance.now();
    const result = await this.query<{
      version: string;
      currentUser: string;
      currentSchema: string;
    }>(
      "testConnection",
      "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128)) AS version, SUSER_SNAME() AS currentUser, SCHEMA_NAME() AS currentSchema",
    );
    if (!result.ok) return result;
    return success({
      latencyMs: Math.round(performance.now() - started),
      serverVersion: result.data[0]?.version,
      engine: "MSSQL" as const,
      currentUser: result.data[0]?.currentUser,
      currentSchema: result.data[0]?.currentSchema,
      compatibilityWarning:
        "Use a SQL Server login with SELECT-only grants. InsightKM blocks non-read-only syntax at the connector boundary.",
    });
  }

  async listSchemas(): Promise<AppResult<DiscoveredSchema[]>> {
    return this.query(
      "listSchemas",
      "SELECT name FROM sys.schemas WHERE name NOT IN ('sys','INFORMATION_SCHEMA') ORDER BY name",
    );
  }

  async listTables(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredTable[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["dbo"];
    const pool = await this.pool().catch((error) => error);
    if (!(pool instanceof sql.ConnectionPool))
      return safeFailure(pool, "listTables");
    try {
      const request = pool.request();
      schemas.forEach((name, index) =>
        request.input(`schema${index}`, sql.NVarChar(128), name),
      );
      const inList = schemas.map((_, index) => `@schema${index}`).join(",");
      const result = await request.query<Record<string, unknown>>(
        `SELECT s.name AS schemaName, o.name,
                CASE WHEN o.type = 'V' THEN 'VIEW' ELSE 'TABLE' END AS tableType,
                CASE WHEN o.type = 'U' THEN SUM(COALESCE(p.rows,0)) ELSE NULL END AS estimatedRowCount,
                CAST(ep.value AS nvarchar(4000)) AS comment
           FROM sys.objects o JOIN sys.schemas s ON s.schema_id=o.schema_id
           LEFT JOIN sys.partitions p ON p.object_id=o.object_id AND p.index_id IN (0,1)
           LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=0 AND ep.name='MS_Description'
          WHERE o.type IN ('U','V') AND s.name IN (${inList})
          GROUP BY s.name,o.name,o.type,ep.value ORDER BY s.name,o.name`,
      );
      return success(
        (result.recordset ?? []).map((row) => ({
          schemaName: String(row.schemaName),
          name: String(row.name),
          tableType: row.tableType === "VIEW" ? "VIEW" : "TABLE",
          estimatedRowCount:
            row.estimatedRowCount == null
              ? null
              : BigInt(String(row.estimatedRowCount)),
          comment: row.comment == null ? null : String(row.comment),
        })),
      );
    } catch (error) {
      return safeFailure(error, "listTables");
    }
  }

  async listColumns(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredColumn[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["dbo"];
    const pool = await this.pool().catch((error) => error);
    if (!(pool instanceof sql.ConnectionPool))
      return safeFailure(pool, "listColumns");
    try {
      const request = pool.request();
      schemas.forEach((name, index) =>
        request.input(`schema${index}`, sql.NVarChar(128), name),
      );
      const inList = schemas.map((_, index) => `@schema${index}`).join(",");
      const result = await request.query<Record<string, unknown>>(
        `SELECT s.name AS schemaName,o.name AS tableName,c.name,
                TYPE_NAME(c.user_type_id) + CASE WHEN TYPE_NAME(c.user_type_id) IN ('varchar','nvarchar','char','nchar','varbinary') THEN '(' + CASE WHEN c.max_length=-1 THEN 'max' ELSE CAST(c.max_length AS varchar(10)) END + ')' ELSE '' END AS dataType,
                c.column_id AS ordinal,c.is_nullable AS nullable,
                CASE WHEN ic.column_id IS NULL THEN 0 ELSE 1 END AS primaryKey,
                dc.definition AS defaultValue,CAST(ep.value AS nvarchar(4000)) AS comment
           FROM sys.columns c JOIN sys.objects o ON o.object_id=c.object_id JOIN sys.schemas s ON s.schema_id=o.schema_id
           LEFT JOIN sys.indexes i ON i.object_id=o.object_id AND i.is_primary_key=1
           LEFT JOIN sys.index_columns ic ON ic.object_id=o.object_id AND ic.index_id=i.index_id AND ic.column_id=c.column_id
           LEFT JOIN sys.default_constraints dc ON dc.object_id=c.default_object_id
           LEFT JOIN sys.extended_properties ep ON ep.major_id=o.object_id AND ep.minor_id=c.column_id AND ep.name='MS_Description'
          WHERE o.type IN ('U','V') AND s.name IN (${inList}) ORDER BY s.name,o.name,c.column_id`,
      );
      return success(
        (result.recordset ?? []).map((row) => ({
          schemaName: String(row.schemaName),
          tableName: String(row.tableName),
          name: String(row.name),
          dataType: String(row.dataType),
          ordinal: Number(row.ordinal),
          nullable: Boolean(row.nullable),
          primaryKey: Boolean(row.primaryKey),
          defaultValue:
            row.defaultValue == null ? null : String(row.defaultValue),
          comment: row.comment == null ? null : String(row.comment),
        })),
      );
    } catch (error) {
      return safeFailure(error, "listColumns");
    }
  }

  async listRelationships(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredRelationship[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["dbo"];
    const pool = await this.pool().catch((error) => error);
    if (!(pool instanceof sql.ConnectionPool))
      return safeFailure(pool, "listRelationships");
    try {
      const request = pool.request();
      schemas.forEach((name, index) =>
        request.input(`schema${index}`, sql.NVarChar(128), name),
      );
      const inList = schemas.map((_, index) => `@schema${index}`).join(",");
      const result = await request.query<Record<string, unknown>>(
        `SELECT fk.name,fs.name AS fromSchema,ft.name AS fromTable,fc.name AS fromColumn,
                ts.name AS toSchema,tt.name AS toTable,tc.name AS toColumn
           FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
           JOIN sys.tables ft ON ft.object_id=fkc.parent_object_id JOIN sys.schemas fs ON fs.schema_id=ft.schema_id JOIN sys.columns fc ON fc.object_id=ft.object_id AND fc.column_id=fkc.parent_column_id
           JOIN sys.tables tt ON tt.object_id=fkc.referenced_object_id JOIN sys.schemas ts ON ts.schema_id=tt.schema_id JOIN sys.columns tc ON tc.object_id=tt.object_id AND tc.column_id=fkc.referenced_column_id
          WHERE fs.name IN (${inList}) ORDER BY fs.name,ft.name,fk.name,fkc.constraint_column_id`,
      );
      return success(
        (result.recordset ?? []).map((row) => ({
          name: String(row.name),
          fromSchema: String(row.fromSchema),
          fromTable: String(row.fromTable),
          fromColumn: String(row.fromColumn),
          toSchema: String(row.toSchema),
          toTable: String(row.toTable),
          toColumn: String(row.toColumn),
        })),
      );
    } catch (error) {
      return safeFailure(error, "listRelationships");
    }
  }

  async fetchSample(schemaName: string, tableName: string, limit = 20) {
    return this.executeReadOnlyQuery(
      `SELECT * FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`,
      {
        maxRows: Math.min(Math.max(limit, 1), 100),
        timeoutMs: 10_000,
      },
    );
  }

  async executeReadOnlyQuery(
    sqlText: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ) {
    const guarded = validateMsSqlReadOnlySql(
      sqlText,
      options?.maxRows ?? 1_000,
    );
    if (!guarded.ok) return guarded;
    try {
      const request = (await this.pool()).request();
      (request as unknown as { timeout: number }).timeout =
        options?.timeoutMs ?? 10_000;
      this.activeRequest = request;
      const result = await request.query<Record<string, unknown>>(
        guarded.data.sql,
      );
      return success(result.recordset ?? []);
    } catch (error) {
      return safeFailure(error, "executeReadOnlyQuery");
    } finally {
      this.activeRequest = undefined;
    }
  }

  async cancelActiveQuery() {
    this.activeRequest?.cancel();
  }
  async close() {
    await this.cancelActiveQuery();
    await this.connection?.close();
    this.connection = undefined;
  }
}
