import { describe, expect, it } from "vitest";
import { fingerprint } from "@/server/services/data-source-service";

describe("data source metadata fingerprinting", () => {
  it("serializes database row estimates returned as bigint", () => {
    expect(() =>
      fingerprint({
        schema: "nexif",
        tables: [{ name: "orders", estimatedRowCount: 216n }],
      }),
    ).not.toThrow();

    expect(fingerprint({ estimatedRowCount: 216n })).toBe(
      fingerprint({ estimatedRowCount: "216" }),
    );
  });
});
