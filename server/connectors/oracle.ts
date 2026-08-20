import oracledb, { type Connection, type Pool } from "oracledb";
import { z } from "zod";
import { logger } from "@/server/services/logger";
import { failure, success, type AppResult } from "@/types/result";
import { validateOracleReadOnlySql } from "./sql-guard";
import type { ConnectorConfiguration, DataConnector } from "./types";

const configSchema = z.object({
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  username: z.string().trim().min(1).max(128),
  password: z.string().min(1),
  oracle: z
    .object({
      connectionType: z.enum(["service_name", "sid"]),
      serviceName: z.string().trim().min(1).max(128).optional(),
      sid: z.string().trim().min(1).max(128).optional(),
      schema: z.string().trim().min(1).max(128).optional(),
      sslMode: z.enum(["disable", "prefer", "require"]).default("disable"),
      connectionTimeoutMs: z
        .number()
        .int()
        .min(1_000)
        .max(60_000)
        .default(15_000),
    })
    .superRefine((value, ctx) => {
      if (value.connectionType === "service_name" && !value.serviceName)
        ctx.addIssue({
          code: "custom",
          message: "Service name is required",
          path: ["serviceName"],
        });
      if (value.connectionType === "sid" && !value.sid)
        ctx.addIssue({
          code: "custom",
          message: "SID is required",
          path: ["sid"],
        });
    }),
});

const pools = new Map<string, Promise<Pool>>();

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function buildOracleConnectString(
  config: NonNullable<ConnectorConfiguration["oracle"]> & {
    host: string;
    port: number;
  },
) {
  if (config.connectionType === "service_name" && config.sslMode !== "require")
    return `${config.host}:${config.port}/${config.serviceName}`;
  const protocol = config.sslMode === "require" ? "TCPS" : "TCP";
  const target =
    config.connectionType === "service_name"
      ? `SERVICE_NAME=${config.serviceName}`
      : `SID=${config.sid}`;
  return `(DESCRIPTION=(ADDRESS=(PROTOCOL=${protocol})(HOST=${config.host})(PORT=${config.port}))(CONNECT_DATA=(${target})))`;
}

function diagnostics(error: unknown) {
  const source =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  return {
    driverCode: typeof source.code === "string" ? source.code : "UNKNOWN",
  };
}

function safeError(error: unknown, operation: string) {
  const requestId = crypto.randomUUID();
  const { driverCode } = diagnostics(error);
  logger.error("Oracle connector operation failed", {
    requestId,
    operation,
    diagnostics: { driverCode },
  });
  const messages: Record<string, string> = {
    ORA_01017: "Oracle rejected the username or password.",
    ORA_12154: "Oracle could not resolve the service name or SID.",
    ORA_12505: "The Oracle listener does not recognize this SID.",
    ORA_12514: "The Oracle listener does not recognize this service name.",
    ORA_12541: "The Oracle listener is unavailable.",
    NJS_503: "The Oracle connection timed out.",
  };
  return failure(
    "CONNECTION_FAILED",
    messages[driverCode] ??
      "The Oracle connection could not be established. Check the connection details and TLS configuration.",
    { requestId, diagnostics: { operation, driverCode } },
  );
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return "[binary data]";
  if (typeof value === "string")
    return value.length > 2_000 ? `${value.slice(0, 2_000)}…` : value;
  if (value instanceof Date) return value.toISOString();
  return value;
}

export class OracleConnector implements DataConnector {
  private activeConnection?: Connection;
  constructor(private readonly configuration: ConnectorConfiguration) {}

  validateConfiguration(): AppResult<{ valid: true }> {
    const parsed = configSchema.safeParse(this.configuration);
    if (parsed.success) return success({ valid: true });
    return failure(
      "VALIDATION_ERROR",
      "The Oracle connection configuration is incomplete.",
      { fieldErrors: parsed.error.flatten().fieldErrors },
    );
  }

  private parsed() {
    return configSchema.parse(this.configuration);
  }
  private usesCurrentUserSchema() {
    const value = this.parsed();
    return (
      !value.oracle.schema ||
      value.oracle.schema.toUpperCase() === value.username.toUpperCase()
    );
  }
  private async pool() {
    const value = this.parsed();
    const key =
      this.configuration.dataSourceId ??
      `ephemeral:${value.host}:${value.port}:${value.username}:${value.oracle.connectionType}:${value.oracle.serviceName ?? value.oracle.sid}`;
    const existingPool = pools.get(key);
    if (existingPool) return existingPool;
    const pool = oracledb.createPool({
      user: value.username,
      password: value.password,
      connectString: buildOracleConnectString({
        ...value.oracle,
        host: value.host,
        port: value.port,
      }),
      poolMin: 0,
      poolMax: 5,
      poolIncrement: 1,
      poolTimeout: 60,
      queueTimeout: value.oracle.connectionTimeoutMs,
      connectTimeout: value.oracle.connectionTimeoutMs,
    });
    pools.set(key, pool);
    return pool;
  }
  private async withConnection<T>(
    operation: string,
    callback: (connection: Connection) => Promise<T>,
  ): Promise<AppResult<T>> {
    try {
      const connection = await (await this.pool()).getConnection();
      this.activeConnection = connection;
      connection.callTimeout = 30_000;
      try {
        return success(await callback(connection));
      } finally {
        this.activeConnection = undefined;
        await connection.close();
      }
    } catch (error) {
      return safeError(error, operation);
    }
  }

  async testConnection() {
    const validated = this.validateConfiguration();
    if (!validated.ok) return validated;
    const started = performance.now();
    return this.withConnection("testConnection", async (connection) => {
      const result = await connection.execute<{
        CURRENT_USER: string;
        CURRENT_SCHEMA: string;
      }>(
        "SELECT USER AS current_user, SYS_CONTEXT('USERENV', 'CURRENT_SCHEMA') AS current_schema FROM dual",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      const row = result.rows?.[0];
      return {
        latencyMs: Math.round(performance.now() - started),
        serverVersion: "Oracle Database",
        engine: "ORACLE" as const,
        currentUser: String(row?.CURRENT_USER ?? ""),
        currentSchema: String(row?.CURRENT_SCHEMA ?? ""),
      };
    });
  }
  async listSchemas() {
    const configuredSchema = this.parsed().oracle.schema;
    if (configuredSchema)
      return success([{ name: configuredSchema.toUpperCase() }]);
    return this.withConnection("listSchemas", async (connection) => {
      const result = await connection.execute<{ NAME: string }>(
        "SELECT username AS name FROM all_users ORDER BY username",
        [],
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({ name: String(row.NAME) }));
    });
  }
  async listTables(schemaNames?: string[]) {
    return this.withConnection("listTables", async (connection) => {
      if (this.usesCurrentUserSchema()) {
        const owner = this.parsed().username.toUpperCase();
        const result = await connection.execute<{
          NAME: string;
          TABLE_TYPE: string;
          NUM_ROWS: number | null;
        }>(
          "SELECT table_name AS name, 'TABLE' AS table_type, num_rows FROM user_tables UNION ALL SELECT view_name AS name, 'VIEW' AS table_type, CAST(NULL AS NUMBER) AS num_rows FROM user_views ORDER BY name",
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return (result.rows ?? []).map((row) => {
          const tableType: "VIEW" | "TABLE" =
            row.TABLE_TYPE === "VIEW" ? "VIEW" : "TABLE";
          return {
            schemaName: owner,
            name: String(row.NAME),
            tableType,
            estimatedRowCount:
              row.NUM_ROWS == null ? null : BigInt(row.NUM_ROWS),
          };
        });
      }
      const schemas = schemaNames?.length
        ? schemaNames
        : [this.parsed().oracle.schema ?? this.parsed().username.toUpperCase()];
      const binds = Object.fromEntries(
        schemas.map((name, index) => [`s${index}`, name]),
      );
      const inList = schemas.map((_, index) => `:s${index}`).join(", ");
      const sql = `SELECT owner, table_name AS name, 'TABLE' AS table_type, num_rows FROM all_tables WHERE owner IN (${inList}) UNION ALL SELECT owner, view_name AS name, 'VIEW' AS table_type, CAST(NULL AS NUMBER) AS num_rows FROM all_views WHERE owner IN (${inList}) ORDER BY owner, name`;
      const result = await connection.execute<{
        OWNER: string;
        NAME: string;
        TABLE_TYPE: string;
        NUM_ROWS: number | null;
      }>(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
      return (result.rows ?? []).map((row) => {
        const tableType: "VIEW" | "TABLE" =
          row.TABLE_TYPE === "VIEW" ? "VIEW" : "TABLE";
        return {
          schemaName: String(row.OWNER),
          name: String(row.NAME),
          tableType,
          estimatedRowCount: row.NUM_ROWS == null ? null : BigInt(row.NUM_ROWS),
        };
      });
    });
  }
  async listColumns(schemaNames?: string[]) {
    return this.withConnection("listColumns", async (connection) => {
      if (this.usesCurrentUserSchema()) {
        const owner = this.parsed().username.toUpperCase();
        const sql =
          "SELECT c.table_name, c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale, c.column_id, c.nullable, c.data_default, CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS primary_key FROM user_tab_columns c LEFT JOIN (SELECT acc.table_name, acc.column_name FROM user_constraints ac JOIN user_cons_columns acc ON ac.constraint_name = acc.constraint_name WHERE ac.constraint_type = 'P') pk ON pk.table_name = c.table_name AND pk.column_name = c.column_name ORDER BY c.table_name, c.column_id";
        const result = await connection.execute<Record<string, unknown>>(
          sql,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return (result.rows ?? []).map((row) => ({
          schemaName: owner,
          tableName: String(row.TABLE_NAME),
          name: String(row.COLUMN_NAME),
          dataType: `${String(row.DATA_TYPE)}${row.DATA_PRECISION != null ? `(${row.DATA_PRECISION}${row.DATA_SCALE != null ? `,${row.DATA_SCALE}` : ""})` : row.DATA_LENGTH != null ? `(${row.DATA_LENGTH})` : ""}`,
          ordinal: Number(row.COLUMN_ID),
          nullable: row.NULLABLE === "Y",
          primaryKey: Number(row.PRIMARY_KEY) === 1,
          defaultValue:
            row.DATA_DEFAULT == null ? null : String(row.DATA_DEFAULT).trim(),
        }));
      }
      const schemas = schemaNames?.length
        ? schemaNames
        : [this.parsed().oracle.schema ?? this.parsed().username.toUpperCase()];
      const binds = Object.fromEntries(
        schemas.map((name, index) => [`s${index}`, name]),
      );
      const inList = schemas.map((_, index) => `:s${index}`).join(", ");
      const sql = `SELECT c.owner, c.table_name, c.column_name, c.data_type, c.data_length, c.data_precision, c.data_scale, c.column_id, c.nullable, c.data_default, CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END AS primary_key FROM all_tab_columns c LEFT JOIN (SELECT acc.owner, acc.table_name, acc.column_name FROM all_constraints ac JOIN all_cons_columns acc ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name WHERE ac.constraint_type = 'P') pk ON pk.owner = c.owner AND pk.table_name = c.table_name AND pk.column_name = c.column_name WHERE c.owner IN (${inList}) ORDER BY c.owner, c.table_name, c.column_id`;
      const result = await connection.execute<Record<string, unknown>>(
        sql,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({
        schemaName: String(row.OWNER),
        tableName: String(row.TABLE_NAME),
        name: String(row.COLUMN_NAME),
        dataType: `${String(row.DATA_TYPE)}${row.DATA_PRECISION != null ? `(${row.DATA_PRECISION}${row.DATA_SCALE != null ? `,${row.DATA_SCALE}` : ""})` : row.DATA_LENGTH != null ? `(${row.DATA_LENGTH})` : ""}`,
        ordinal: Number(row.COLUMN_ID),
        nullable: row.NULLABLE === "Y",
        primaryKey: Number(row.PRIMARY_KEY) === 1,
        defaultValue:
          row.DATA_DEFAULT == null ? null : String(row.DATA_DEFAULT).trim(),
      }));
    });
  }
  async listRelationships(schemaNames?: string[]) {
    return this.withConnection("listRelationships", async (connection) => {
      if (this.usesCurrentUserSchema()) {
        const owner = this.parsed().username.toUpperCase();
        const sql =
          "SELECT fk.constraint_name, fk.table_name AS from_table, fkc.column_name AS from_column, pk.table_name AS to_table, pkc.column_name AS to_column FROM user_constraints fk JOIN user_cons_columns fkc ON fk.constraint_name = fkc.constraint_name JOIN user_constraints pk ON fk.r_constraint_name = pk.constraint_name JOIN user_cons_columns pkc ON pk.constraint_name = pkc.constraint_name AND pkc.position = fkc.position WHERE fk.constraint_type = 'R' ORDER BY fk.table_name, fk.constraint_name, fkc.position";
        const result = await connection.execute<Record<string, unknown>>(
          sql,
          [],
          { outFormat: oracledb.OUT_FORMAT_OBJECT },
        );
        return (result.rows ?? []).map((row) => ({
          name: String(row.CONSTRAINT_NAME),
          fromSchema: owner,
          fromTable: String(row.FROM_TABLE),
          fromColumn: String(row.FROM_COLUMN),
          toSchema: owner,
          toTable: String(row.TO_TABLE),
          toColumn: String(row.TO_COLUMN),
        }));
      }
      const schemas = schemaNames?.length
        ? schemaNames
        : [this.parsed().oracle.schema ?? this.parsed().username.toUpperCase()];
      const binds = Object.fromEntries(
        schemas.map((name, index) => [`s${index}`, name]),
      );
      const inList = schemas.map((_, index) => `:s${index}`).join(", ");
      const sql = `SELECT fk.constraint_name, fk.owner AS from_schema, fk.table_name AS from_table, fkc.column_name AS from_column, pk.owner AS to_schema, pk.table_name AS to_table, pkc.column_name AS to_column FROM all_constraints fk JOIN all_cons_columns fkc ON fk.owner = fkc.owner AND fk.constraint_name = fkc.constraint_name JOIN all_constraints pk ON fk.r_owner = pk.owner AND fk.r_constraint_name = pk.constraint_name JOIN all_cons_columns pkc ON pk.owner = pkc.owner AND pk.constraint_name = pkc.constraint_name AND pkc.position = fkc.position WHERE fk.constraint_type = 'R' AND fk.owner IN (${inList}) ORDER BY fk.owner, fk.table_name, fk.constraint_name, fkc.position`;
      const result = await connection.execute<Record<string, unknown>>(
        sql,
        binds,
        { outFormat: oracledb.OUT_FORMAT_OBJECT },
      );
      return (result.rows ?? []).map((row) => ({
        name: String(row.CONSTRAINT_NAME),
        fromSchema: String(row.FROM_SCHEMA),
        fromTable: String(row.FROM_TABLE),
        fromColumn: String(row.FROM_COLUMN),
        toSchema: String(row.TO_SCHEMA),
        toTable: String(row.TO_TABLE),
        toColumn: String(row.TO_COLUMN),
      }));
    });
  }
  async fetchSample(schemaName: string, tableName: string, limit = 20) {
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 100);
    return this.executeReadOnlyQuery(
      `SELECT * FROM ${quoteIdentifier(schemaName)}.${quoteIdentifier(tableName)} FETCH FIRST ${safeLimit} ROWS ONLY`,
      { timeoutMs: 10_000 },
    );
  }
  async executeReadOnlyQuery(
    sql: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ) {
    const guarded = validateOracleReadOnlySql(sql, options?.maxRows ?? 1_000);
    if (!guarded.ok) return guarded;
    return this.withConnection("executeReadOnlyQuery", async (connection) => {
      connection.callTimeout = options?.timeoutMs ?? 10_000;
      const result = await connection.execute<Record<string, unknown>>(
        guarded.data.sql,
        [],
        {
          outFormat: oracledb.OUT_FORMAT_OBJECT,
          maxRows: Math.min(options?.maxRows ?? 1_000, 10_000),
          fetchArraySize: 100,
        },
      );
      return (result.rows ?? []).map((row) =>
        Object.fromEntries(
          Object.entries(row).map(([key, value]) => [
            key,
            normalizeValue(value),
          ]),
        ),
      );
    });
  }
  async close() {
    /* Shared pools remain warm and are released on process shutdown. */
  }
  async cancelActiveQuery() {
    await this.activeConnection?.break();
  }
}
