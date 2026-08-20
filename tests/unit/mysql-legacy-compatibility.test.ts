import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createConnection: vi.fn(),
  query: vi.fn(),
  end: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  default: { createConnection: mocks.createConnection },
}));

import { MySqlConnector } from "@/server/connectors/mysql";

describe("MySqlConnector legacy transaction compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createConnection.mockResolvedValue({
      query: mocks.query,
      end: mocks.end,
      destroy: mocks.destroy,
    });
    mocks.query.mockImplementation((statement: string | { sql: string }) => {
      if (statement === "START TRANSACTION READ ONLY") {
        return Promise.reject(
          Object.assign(new Error("Unsupported transaction syntax"), {
            code: "ER_PARSE_ERROR",
            errno: 1064,
            sqlState: "42000",
          }),
        );
      }
      if (typeof statement === "object")
        return Promise.resolve([[{ value: 1 }]]);
      return Promise.resolve([[]]);
    });
  });

  it("falls back to a guarded transaction on MariaDB 5.5", async () => {
    const connector = new MySqlConnector({
      host: "database.internal",
      port: 3306,
      databaseName: "nexif",
      username: "readonly",
      password: "secret",
      sslEnabled: false,
      connectionOptions: {},
    });

    const result = await connector.executeReadOnlyQuery("SELECT 1 AS value", {
      maxRows: 10,
    });

    expect(result).toEqual({ ok: true, data: [{ value: 1 }] });
    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      "START TRANSACTION READ ONLY",
    );
    expect(mocks.query).toHaveBeenNthCalledWith(2, "START TRANSACTION");
    expect(mocks.query).toHaveBeenLastCalledWith("ROLLBACK");
  });
});
