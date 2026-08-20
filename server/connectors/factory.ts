import type { DataSourceType } from "@/generated/prisma/enums";
import { MySqlConnector } from "./mysql";
import { OracleConnector } from "./oracle";
import { PostgreSqlConnector } from "./postgresql";
import { MsSqlConnector } from "./mssql";
import { UnsupportedConnector } from "./unsupported";
import type { ConnectorConfiguration, DataConnector } from "./types";

export function createConnector(
  type: DataSourceType,
  configuration: ConnectorConfiguration,
): DataConnector {
  if (type === "MYSQL") return new MySqlConnector(configuration);
  if (type === "ORACLE") return new OracleConnector(configuration);
  if (type === "POSTGRESQL") return new PostgreSqlConnector(configuration);
  if (type === "MSSQL") return new MsSqlConnector(configuration);
  return new UnsupportedConnector(type, configuration);
}
