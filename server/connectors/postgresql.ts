import { Pool, type PoolClient } from "pg";
import { z } from "zod";
import { logger } from "@/server/services/logger";
import { failure, success, type AppResult } from "@/types/result";
import { validatePostgreSqlReadOnlySql } from "./sql-guard";
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
  sslEnabled: z.boolean().optional().default(false),
  connectionOptions: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .default({}),
});

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function safeFailure(error: unknown, operation: string) {
  const requestId = crypto.randomUUID();
  const code =
    error && typeof error === "object" && "code" in error
      ? String(error.code)
      : "UNKNOWN";
  logger.error("PostgreSQL connector operation failed", {
    requestId,
    operation,
    diagnostics: { driverCode: code },
  });
  const messages: Record<string, string> = {
    "28P01": "PostgreSQL rejected the username or password.",
    "3D000": "The PostgreSQL database does not exist.",
    ECONNREFUSED: "The PostgreSQL server refused the connection.",
    ENOTFOUND: "The PostgreSQL host could not be found.",
    ETIMEDOUT: "The PostgreSQL connection timed out.",
    "57014": "The PostgreSQL query exceeded the configured timeout.",
  };
  return failure(
    "CONNECTION_FAILED",
    messages[code] ?? "The PostgreSQL operation could not be completed.",
    { requestId, diagnostics: { operation, driverCode: code } },
  );
}

export class PostgreSqlConnector implements DataConnector {
  private database?: Pool;
  private activeClient?: PoolClient;

  constructor(private readonly configuration: ConnectorConfiguration) {}

  validateConfiguration(): AppResult<{ valid: true }> {
    const parsed = configurationSchema.safeParse(this.configuration);
    return parsed.success
      ? success({ valid: true })
      : failure(
          "VALIDATION_ERROR",
          "The PostgreSQL connection configuration is incomplete.",
          { fieldErrors: parsed.error.flatten().fieldErrors },
        );
  }

  private parsed() {
    return configurationSchema.parse(this.configuration);
  }

  private pool() {
    if (this.database) return this.database;
    const value = this.parsed();
    this.database = new Pool({
      host: value.host,
      port: value.port,
      database: value.databaseName,
      user: value.username,
      password: value.password,
      connectionTimeoutMillis: Math.min(
        Number(value.connectionOptions.connectionTimeoutMs ?? 15_000),
        60_000,
      ),
      max: 5,
      ssl: value.sslEnabled
        ? {
            rejectUnauthorized:
              value.connectionOptions.trustServerCertificate !== true,
          }
        : undefined,
    });
    return this.database;
  }

  private async query<T extends Record<string, unknown>>(
    operation: string,
    sql: string,
    values: unknown[] = [],
  ): Promise<AppResult<T[]>> {
    try {
      const result = await this.pool().query<T>(sql, values);
      return success(result.rows);
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
      current_user: string;
      current_schema: string;
      read_only: string;
    }>(
      "testConnection",
      "SELECT version(), current_user, current_schema(), current_setting('transaction_read_only') AS read_only",
    );
    if (!result.ok) return result;
    const row = result.data[0];
    return success({
      latencyMs: Math.round(performance.now() - started),
      serverVersion: row?.version,
      engine: "POSTGRESQL" as const,
      currentUser: row?.current_user,
      currentSchema: row?.current_schema,
      compatibilityWarning:
        row?.read_only === "on"
          ? undefined
          : "The account is not database-level read-only. InsightKM still enforces a read-only transaction and SQL guard, but a read-only database role is strongly recommended.",
    });
  }

  async listSchemas(): Promise<AppResult<DiscoveredSchema[]>> {
    return this.query<DiscoveredSchema>(
      "listSchemas",
      `SELECT schema_name AS name
         FROM information_schema.schemata
        WHERE schema_name <> 'information_schema'
          AND schema_name NOT LIKE 'pg_%'
        ORDER BY schema_name`,
    );
  }

  async listTables(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredTable[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["public"];
    const result = await this.query<{
      schemaName: string;
      name: string;
      tableType: string;
      estimatedRowCount: string | number | null;
      comment: string | null;
    }>(
      "listTables",
      `SELECT n.nspname AS "schemaName", c.relname AS name,
              CASE WHEN c.relkind IN ('v','m') THEN 'VIEW' ELSE 'TABLE' END AS "tableType",
              CASE WHEN c.relkind IN ('r','p') THEN GREATEST(c.reltuples, 0)::bigint ELSE NULL END AS "estimatedRowCount",
              obj_description(c.oid, 'pg_class') AS comment
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m')
        ORDER BY n.nspname, c.relname`,
      [schemas],
    );
    if (!result.ok) return result;
    return success(
      result.data.map((row) => ({
        schemaName: row.schemaName,
        name: row.name,
        tableType: row.tableType === "VIEW" ? "VIEW" : "TABLE",
        estimatedRowCount:
          row.estimatedRowCount == null ? null : BigInt(row.estimatedRowCount),
        comment: row.comment,
      })),
    );
  }

  async listColumns(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredColumn[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["public"];
    const result = await this.query<Record<string, unknown>>(
      "listColumns",
      `SELECT n.nspname AS "schemaName", c.relname AS "tableName", a.attname AS name,
              format_type(a.atttypid, a.atttypmod) AS "dataType", a.attnum AS ordinal,
              NOT a.attnotnull AS nullable,
              EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey)) AS "primaryKey",
              pg_get_expr(d.adbin, d.adrelid) AS "defaultValue",
              col_description(c.oid, a.attnum) AS comment
         FROM pg_attribute a
         JOIN pg_class c ON c.oid = a.attrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
        WHERE n.nspname = ANY($1::text[]) AND c.relkind IN ('r','p','v','m')
          AND a.attnum > 0 AND NOT a.attisdropped
        ORDER BY n.nspname, c.relname, a.attnum`,
      [schemas],
    );
    if (!result.ok) return result;
    return success(
      result.data.map((row) => ({
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
  }

  async listRelationships(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredRelationship[]>> {
    const schemas = schemaNames?.length ? schemaNames : ["public"];
    return this.query<DiscoveredRelationship>(
      "listRelationships",
      `SELECT tc.constraint_name AS name,
              tc.table_schema AS "fromSchema", tc.table_name AS "fromTable", kcu.column_name AS "fromColumn",
              ccu.table_schema AS "toSchema", ccu.table_name AS "toTable", ccu.column_name AS "toColumn"
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON tc.constraint_catalog = kcu.constraint_catalog AND tc.constraint_schema = kcu.constraint_schema AND tc.constraint_name = kcu.constraint_name
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_catalog = tc.constraint_catalog AND ccu.constraint_schema = tc.constraint_schema AND ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = ANY($1::text[])
        ORDER BY tc.table_schema, tc.table_name, tc.constraint_name, kcu.ordinal_position`,
      [schemas],
    );
  }

  async fetchSample(schemaName: string, tableName: string, limit = 20) {
    return this.executeReadOnlyQuery(
      `SELECT * FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)}`,
      { maxRows: Math.min(Math.max(limit, 1), 100), timeoutMs: 10_000 },
    );
  }

  async executeReadOnlyQuery(
    sql: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ) {
    const guarded = validatePostgreSqlReadOnlySql(
      sql,
      options?.maxRows ?? 1_000,
    );
    if (!guarded.ok) return guarded;
    let client: PoolClient | undefined;
    try {
      client = await this.pool().connect();
      this.activeClient = client;
      await client.query("BEGIN READ ONLY");
      await client.query("SELECT set_config('statement_timeout', $1, true)", [
        String(options?.timeoutMs ?? 10_000),
      ]);
      const result = await client.query<Record<string, unknown>>(
        guarded.data.sql,
      );
      await client.query("ROLLBACK");
      return success(result.rows);
    } catch (error) {
      try {
        await client?.query("ROLLBACK");
      } catch {
        /* connection may be cancelled */
      }
      return safeFailure(error, "executeReadOnlyQuery");
    } finally {
      this.activeClient = undefined;
      client?.release();
    }
  }

  async cancelActiveQuery() {
    if (this.activeClient) {
      this.activeClient.release(true);
      this.activeClient = undefined;
    }
  }

  async close() {
    await this.cancelActiveQuery();
    await this.database?.end();
    this.database = undefined;
  }
}
