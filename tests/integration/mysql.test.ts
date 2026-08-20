import { describe, expect, it } from "vitest";
import { MySqlConnector } from "@/server/connectors/mysql";

const enabled = Boolean(process.env.TEST_MYSQL_HOST);
describe.skipIf(!enabled)("MySQL integration", () => {
  it("tests and discovers the Docker fixture", async () => {
    const connector = new MySqlConnector({
      host: process.env.TEST_MYSQL_HOST,
      port: Number(process.env.TEST_MYSQL_PORT || 3306),
      databaseName: "analytics_fixture",
      username: "readonly_user",
      password: "readonly_password",
      sslEnabled: false,
      connectionOptions: {},
    });
    try {
      expect((await connector.testConnection()).ok).toBe(true);
      const tables = await connector.listTables(["analytics_fixture"]);
      expect(tables.ok).toBe(true);
      if (tables.ok)
        expect(tables.data.map((table) => table.name)).toEqual(
          expect.arrayContaining([
            "customers",
            "orders",
            "customer_order_summary",
          ]),
        );
      const relationships = await connector.listRelationships([
        "analytics_fixture",
      ]);
      expect(relationships.ok).toBe(true);
      if (relationships.ok)
        expect(
          relationships.data.some(
            (item) =>
              item.fromTable === "orders" && item.toTable === "customers",
          ),
        ).toBe(true);
      const query = await connector.executeReadOnlyQuery(
        "SELECT COUNT(*) AS order_count FROM analytics_fixture.orders LIMIT 10",
        { timeoutMs: 5_000 },
      );
      expect(query.ok).toBe(true);
      if (query.ok)
        expect(Number(query.data[0].order_count)).toBeGreaterThan(0);
      expect(
        (
          await connector.executeReadOnlyQuery(
            "DELETE FROM analytics_fixture.orders",
          )
        ).ok,
      ).toBe(false);
    } finally {
      await connector.close();
    }
  });
});
