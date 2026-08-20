import { describe, expect, it } from "vitest";
import { hasRole } from "@/server/auth/roles";
import { redact } from "@/server/services/logger";

describe("authorization and redaction", () => {
  it("enforces the role hierarchy", () => {
    expect(hasRole("OWNER", "ADMIN")).toBe(true);
    expect(hasRole("DASHBOARD_DESIGNER", "ADMIN")).toBe(false);
    expect(hasRole("VIEWER", "ANALYST")).toBe(false);
  });
  it("recursively redacts secrets", () => {
    expect(
      redact({
        host: "db",
        password: "secret",
        nested: { accessToken: "token", value: 4 },
      }),
    ).toEqual({
      host: "db",
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]", value: 4 },
    });
  });
});
