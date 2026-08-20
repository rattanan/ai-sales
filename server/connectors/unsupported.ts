import { failure, success, type AppResult } from "@/types/result";
import type { ConnectorConfiguration, DataConnector } from "./types";

export class UnsupportedConnector implements DataConnector {
  constructor(
    private readonly name: string,
    private readonly configuration: ConnectorConfiguration,
  ) {}

  validateConfiguration(): AppResult<{ valid: true }> {
    return this.configuration
      ? success({ valid: true })
      : failure("VALIDATION_ERROR", "Configuration is required.");
  }
  private unavailable(): AppResult<never> {
    return failure(
      "CONNECTOR_NOT_IMPLEMENTED",
      `${this.name} connectivity is planned for a later phase.`,
    );
  }
  async testConnection() {
    return this.unavailable();
  }
  async listSchemas() {
    return this.unavailable();
  }
  async listTables() {
    return this.unavailable();
  }
  async listColumns() {
    return this.unavailable();
  }
  async listRelationships() {
    return this.unavailable();
  }
  async fetchSample() {
    return this.unavailable();
  }
  async executeReadOnlyQuery() {
    return this.unavailable();
  }
  async close() {}
  async cancelActiveQuery() {}
}
