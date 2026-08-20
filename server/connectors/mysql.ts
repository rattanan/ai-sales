import mysql, { type Connection, type RowDataPacket } from "mysql2/promise";
import { z } from "zod";
import { logger } from "@/server/services/logger";
import { failure, success, type AppResult } from "@/types/result";
import { validateReadOnlySql } from "./sql-guard";
import type {
  ConnectorConfiguration,
  DataConnector,
  DiscoveredColumn,
  DiscoveredRelationship,
  DiscoveredSchema,
  DiscoveredTable,
} from "./types";

const SYSTEM_SCHEMAS = [
  "information_schema",
  "mysql",
  "performance_schema",
  "sys",
];

const connectorConfigurationSchema = z.object({
  host: z.string().trim().min(1),
  port: z.number().int().min(1).max(65535),
  databaseName: z.string().trim().min(1),
  username: z.string().trim().min(1),
  password: z.string().min(1),
  sslEnabled: z.boolean().optional().default(false),
  connectionOptions: z
    .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
    .optional()
    .default({}),
});

type SafeDiagnostics = Record<string, string | number | boolean | null>;

function getSafeDiagnostics(error: unknown): SafeDiagnostics {
  if (!error || typeof error !== "object") return { driverCode: "UNKNOWN" };
  const source = error as Record<string, unknown>;
  const diagnostics: SafeDiagnostics = {};
  const safeFields = ["code", "errno", "sqlState", "syscall", "fatal"] as const;
  for (const field of safeFields) {
    const value = source[field];
    if (["string", "number", "boolean"].includes(typeof value)) {
      diagnostics[field === "code" ? "driverCode" : field] = value as
        string | number | boolean;
    }
  }
  return Object.keys(diagnostics).length
    ? diagnostics
    : { driverCode: "UNKNOWN" };
}

function normalizeConnectionError(error: unknown) {
  const code = String(getSafeDiagnostics(error).driverCode ?? "UNKNOWN");
  const messages: Record<string, string> = {
    ER_ACCESS_DENIED_ERROR: "MySQL rejected the username or password.",
    ENOTFOUND: "The database host could not be found.",
    ECONNREFUSED:
      "The database refused the connection. Check the host and port.",
    ETIMEDOUT: "The database connection timed out.",
    HANDSHAKE_SSL_ERROR: "The TLS connection could not be established.",
  };
  return (
    messages[code] ??
    "The MySQL connection could not be established. Check the connection details."
  );
}

function connectorFailure(error: unknown, operation: string) {
  const requestId = crypto.randomUUID();
  const diagnostics = getSafeDiagnostics(error);
  logger.error("MySQL connector operation failed", {
    requestId,
    operation,
    diagnostics,
  });
  return failure("CONNECTION_FAILED", normalizeConnectionError(error), {
    requestId,
    diagnostics: { operation, ...diagnostics },
  });
}

function isTransientConnectionError(error: unknown) {
  const code = String(getSafeDiagnostics(error).driverCode ?? "UNKNOWN");
  return new Set([
    "ETIMEDOUT",
    "ECONNRESET",
    "EPIPE",
    "PROTOCOL_CONNECTION_LOST",
  ]).has(code);
}

function isLegacyReadOnlyTransactionSyntaxError(error: unknown) {
  const diagnostics = getSafeDiagnostics(error);
  return (
    diagnostics.driverCode === "ER_PARSE_ERROR" && diagnostics.errno === 1064
  );
}

function wait(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function quoteIdentifier(value: string) {
  return `\`${value.replaceAll("`", "``")}\``;
}

export class MySqlConnector implements DataConnector {
  private connection?: Connection;

  constructor(private readonly configuration: ConnectorConfiguration) {}

  validateConfiguration(): AppResult<{ valid: true }> {
    const parsed = connectorConfigurationSchema.safeParse(this.configuration);
    if (parsed.success) return success({ valid: true });
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const missingFields = Object.keys(fieldErrors).join(", ");
    const requestId = crypto.randomUUID();
    logger.warn("MySQL connector configuration validation failed", {
      requestId,
      missingFields: Object.keys(fieldErrors),
    });
    return failure(
      "VALIDATION_ERROR",
      "The MySQL connection configuration is incomplete.",
      {
        requestId,
        fieldErrors,
        diagnostics: {
          operation: "validateConfiguration",
          invalidFields: missingFields || "unknown",
        },
      },
    );
  }

  private async getConnection() {
    if (this.connection) return this.connection;
    this.connection = await mysql.createConnection({
      host: this.configuration.host,
      port: this.configuration.port,
      database: this.configuration.databaseName,
      user: this.configuration.username,
      password: this.configuration.password,
      ssl: this.configuration.sslEnabled ? {} : undefined,
      connectTimeout: 15_000,
      multipleStatements: false,
      rowsAsArray: false,
    });
    return this.connection;
  }

  async testConnection(): Promise<
    AppResult<{
      latencyMs: number;
      serverVersion?: string;
      engine?: "MYSQL" | "MARIADB";
      compatibilityWarning?: string;
    }>
  > {
    const validation = this.validateConfiguration();
    if (!validation.ok) return validation;
    const started = performance.now();
    try {
      const connection = await this.getConnection();
      const [rows] = await connection.query<RowDataPacket[]>(
        "SELECT VERSION() AS version",
      );
      const serverVersion = String(rows[0]?.version ?? "");
      const isMariaDb = /mariadb/i.test(serverVersion);
      const isLegacyMariaDb = isMariaDb && /^5\.5(?:\.|-)/.test(serverVersion);
      return success({
        latencyMs: Math.round(performance.now() - started),
        serverVersion,
        engine: isMariaDb ? "MARIADB" : "MYSQL",
        compatibilityWarning: isLegacyMariaDb
          ? "MariaDB 5.5 connected in legacy compatibility mode. This server version is end-of-life and may not support modern TLS. Upgrade is strongly recommended."
          : undefined,
      });
    } catch (error) {
      return connectorFailure(error, "testConnection");
    }
  }

  async listSchemas(): Promise<AppResult<DiscoveredSchema[]>> {
    try {
      const [rows] = await (
        await this.getConnection()
      ).query<RowDataPacket[]>(
        "SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN (?, ?, ?, ?) ORDER BY SCHEMA_NAME",
        SYSTEM_SCHEMAS,
      );
      return success(rows.map((row) => ({ name: String(row.name) })));
    } catch (error) {
      return connectorFailure(error, "listSchemas");
    }
  }

  async listTables(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredTable[]>> {
    try {
      const values = schemaNames?.length
        ? schemaNames
        : [this.configuration.databaseName!];
      const [rows] = await (
        await this.getConnection()
      ).query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE, TABLE_ROWS, TABLE_COMMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (${values.map(() => "?").join(",")}) ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        values,
      );
      return success(
        rows.map((row) => ({
          schemaName: String(row.TABLE_SCHEMA),
          name: String(row.TABLE_NAME),
          tableType: String(row.TABLE_TYPE) === "VIEW" ? "VIEW" : "TABLE",
          estimatedRowCount:
            row.TABLE_ROWS == null ? null : BigInt(row.TABLE_ROWS),
          comment: row.TABLE_COMMENT == null ? null : String(row.TABLE_COMMENT),
        })),
      );
    } catch (error) {
      return connectorFailure(error, "listTables");
    }
  }

  async listColumns(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredColumn[]>> {
    try {
      const values = schemaNames?.length
        ? schemaNames
        : [this.configuration.databaseName!];
      const [rows] = await (
        await this.getConnection()
      ).query<RowDataPacket[]>(
        `SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, ORDINAL_POSITION, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, COLUMN_COMMENT FROM information_schema.COLUMNS WHERE TABLE_SCHEMA IN (${values.map(() => "?").join(",")}) ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION`,
        values,
      );
      return success(
        rows.map((row) => ({
          schemaName: String(row.TABLE_SCHEMA),
          tableName: String(row.TABLE_NAME),
          name: String(row.COLUMN_NAME),
          dataType: String(row.COLUMN_TYPE),
          ordinal: Number(row.ORDINAL_POSITION),
          nullable: row.IS_NULLABLE === "YES",
          primaryKey: row.COLUMN_KEY === "PRI",
          defaultValue:
            row.COLUMN_DEFAULT == null ? null : String(row.COLUMN_DEFAULT),
          comment:
            row.COLUMN_COMMENT == null ? null : String(row.COLUMN_COMMENT),
        })),
      );
    } catch (error) {
      return connectorFailure(error, "listColumns");
    }
  }

  async listRelationships(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredRelationship[]>> {
    try {
      const values = schemaNames?.length
        ? schemaNames
        : [this.configuration.databaseName!];
      const [rows] = await (
        await this.getConnection()
      ).query<RowDataPacket[]>(
        `SELECT CONSTRAINT_NAME, TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE REFERENCED_TABLE_NAME IS NOT NULL AND TABLE_SCHEMA IN (${values.map(() => "?").join(",")}) ORDER BY TABLE_SCHEMA, TABLE_NAME`,
        values,
      );
      return success(
        rows.map((row) => ({
          name: String(row.CONSTRAINT_NAME),
          fromSchema: String(row.TABLE_SCHEMA),
          fromTable: String(row.TABLE_NAME),
          fromColumn: String(row.COLUMN_NAME),
          toSchema: String(row.REFERENCED_TABLE_SCHEMA),
          toTable: String(row.REFERENCED_TABLE_NAME),
          toColumn: String(row.REFERENCED_COLUMN_NAME),
        })),
      );
    } catch (error) {
      return connectorFailure(error, "listRelationships");
    }
  }

  async fetchSample(schemaName: string, tableName: string, limit = 20) {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.executeReadOnlyQuery(
      `SELECT * FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} LIMIT ${safeLimit}`,
    );
  }

  async executeReadOnlyQuery(
    sql: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ): Promise<AppResult<Record<string, unknown>[]>> {
    const guarded = validateReadOnlySql(sql, options?.maxRows ?? 1_000);
    if (!guarded.ok) return guarded;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const connection = await this.getConnection();
        try {
          await connection.query("START TRANSACTION READ ONLY");
        } catch (error) {
          if (!isLegacyReadOnlyTransactionSyntaxError(error)) throw error;
          logger.warn(
            "Falling back to a guarded transaction for legacy MySQL compatibility",
            {
              operation: "executeReadOnlyQuery",
              diagnostics: getSafeDiagnostics(error),
            },
          );
          await connection.query("START TRANSACTION");
        }
        const [rows] = await connection.query<RowDataPacket[]>({
          sql: guarded.data.sql,
          timeout: options?.timeoutMs ?? 10_000,
        });
        await connection.query("ROLLBACK");
        return success(rows as Record<string, unknown>[]);
      } catch (error) {
        try {
          await this.connection?.query("ROLLBACK");
        } catch {
          /* connection may be unavailable */
        }
        if (attempt === 0 && isTransientConnectionError(error)) {
          this.connection?.destroy();
          this.connection = undefined;
          logger.warn("Retrying transient MySQL connection failure", {
            operation: "executeReadOnlyQuery",
            diagnostics: getSafeDiagnostics(error),
            attempt: attempt + 1,
          });
          await wait(250);
          continue;
        }
        return connectorFailure(error, "executeReadOnlyQuery");
      }
    }
    return failure(
      "CONNECTION_FAILED",
      "The MySQL query could not be completed.",
    );
  }

  async close() {
    if (this.connection) await this.connection.end();
    this.connection = undefined;
  }

  async cancelActiveQuery() {
    this.connection?.destroy();
    this.connection = undefined;
  }
}
