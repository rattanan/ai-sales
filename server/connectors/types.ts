import type { AppResult } from "@/types/result";

export type ConnectorConfiguration = {
  dataSourceId?: string;
  host?: string;
  port?: number;
  databaseName?: string;
  username?: string;
  password?: string;
  sslEnabled?: boolean;
  connectionOptions?: Record<string, string | number | boolean>;
  oracle?: OracleConnectionConfiguration;
};

export type OracleConnectionConfiguration = {
  connectionType: "service_name" | "sid";
  serviceName?: string;
  sid?: string;
  schema?: string;
  sslMode?: "disable" | "prefer" | "require";
  connectionTimeoutMs?: number;
};

export type DiscoveredSchema = { name: string };
export type DiscoveredTable = {
  schemaName: string;
  name: string;
  tableType: "TABLE" | "VIEW";
  estimatedRowCount: bigint | null;
  comment?: string | null;
};
export type DiscoveredColumn = {
  schemaName: string;
  tableName: string;
  name: string;
  dataType: string;
  ordinal: number;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  comment?: string | null;
};
export type DiscoveredRelationship = {
  name: string;
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
};

export interface DataConnector {
  validateConfiguration(): AppResult<{ valid: true }>;
  testConnection(): Promise<
    AppResult<{
      latencyMs: number;
      serverVersion?: string;
      engine?: "MYSQL" | "MARIADB" | "POSTGRESQL" | "MSSQL" | "ORACLE";
      compatibilityWarning?: string;
      currentUser?: string;
      currentSchema?: string;
    }>
  >;
  listSchemas(): Promise<AppResult<DiscoveredSchema[]>>;
  listTables(schemaNames?: string[]): Promise<AppResult<DiscoveredTable[]>>;
  listColumns(schemaNames?: string[]): Promise<AppResult<DiscoveredColumn[]>>;
  listRelationships(
    schemaNames?: string[],
  ): Promise<AppResult<DiscoveredRelationship[]>>;
  fetchSample(
    schemaName: string,
    tableName: string,
    limit?: number,
  ): Promise<AppResult<Record<string, unknown>[]>>;
  executeReadOnlyQuery(
    sql: string,
    options?: { timeoutMs?: number; maxRows?: number },
  ): Promise<AppResult<Record<string, unknown>[]>>;
  cancelActiveQuery(): Promise<void>;
  close(): Promise<void>;
}
