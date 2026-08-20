import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { loginSchema, resetPasswordSchema } from "@/schemas/auth";
import {
  createUserSchema,
  deleteUserSchema,
  llmProviderSchema,
  privacyPolicySchema,
} from "@/schemas/admin";
import { PERMISSIONS, SYSTEM_ROLES } from "@/server/auth/permission-catalog";
import { ExcelUploadService } from "@/server/services/excel";
import type { ObjectStorageService } from "@/server/storage/object-storage";
import { redact } from "@/server/services/logger";

const storage: ObjectStorageService = {
  async put({ bytes }) {
    return { key: "opaque", size: bytes.length, checksum: "checksum" };
  },
  async get() {
    return Buffer.alloc(0);
  },
  async delete() {},
};

describe("enterprise security policy", () => {
  it("accepts username login and validates strong reset passwords", () => {
    expect(
      loginSchema.safeParse({
        identifier: "analyst",
        password: "secret",
        rememberMe: "on",
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: "a".repeat(43),
        password: "SecurePassword1",
        confirmPassword: "SecurePassword1",
      }).success,
    ).toBe(true);
    expect(
      resetPasswordSchema.safeParse({
        token: "a".repeat(43),
        password: "weak",
        confirmPassword: "weak",
      }).success,
    ).toBe(false);
  });

  it("requires unique administrator-provisioned identity fields", () => {
    expect(
      createUserSchema.safeParse({
        name: "Data Manager",
        email: "manager@example.test",
        username: "data.manager",
        roleId: "role",
        temporaryPassword: "SecurePassword1",
        status: "ACTIVE",
        forcePasswordChange: "on",
        copilotEnabled: false,
      }).success,
    ).toBe(true);
  });

  it("requires an exact, valid email confirmation before deleting a user", () => {
    expect(
      deleteUserSchema.safeParse({
        userId: "user-id",
        confirmationEmail: "user@example.test",
      }).success,
    ).toBe(true);
    expect(
      deleteUserSchema.safeParse({
        userId: "user-id",
        confirmationEmail: "not-an-email",
      }).success,
    ).toBe(false);
  });

  it("keeps role permissions centralized and least privilege", () => {
    expect(SYSTEM_ROLES.ADMIN.permissions).toEqual(PERMISSIONS);
    expect(SYSTEM_ROLES.MANAGER.permissions).toContain("knowledge.manage");
    expect(SYSTEM_ROLES.MANAGER.permissions).not.toContain("provider.manage");
    expect(SYSTEM_ROLES.USER.permissions).toContain("chat.use");
    expect(SYSTEM_ROLES.SYSTEM_ADMIN.permissions).toEqual(PERMISSIONS);
    expect(SYSTEM_ROLES.DATA_SOURCE_MANAGER.permissions).toContain(
      "excel.replace",
    );
    expect(SYSTEM_ROLES.DATA_SOURCE_MANAGER.permissions).not.toContain(
      "user.create",
    );
    expect(SYSTEM_ROLES.DASHBOARD_VIEWER.permissions).not.toContain(
      "dashboard.update",
    );
  });

  it("validates provider/privacy configuration and redacts API keys", () => {
    expect(
      llmProviderSchema.safeParse({
        name: "Primary AI",
        baseUrl: "https://api.example.test/v1",
        chatModel: "chat-model",
        embeddingModel: "embedding-model",
        apiKey: "secret-value",
        temperature: "0.2",
        timeoutMs: "30000",
        maxTokens: "4096",
        active: "on",
        supportsJsonSchema: "on",
      }).success,
    ).toBe(true);
    expect(
      privacyPolicySchema.safeParse({
        enabled: "on",
        maskEmail: "on",
        maskPhone: "on",
        maskNationalId: "on",
        maskFinancialAccount: "on",
        auditLogDays: "365",
        loginHistoryDays: "180",
        chatHistoryDays: "90",
      }).success,
    ).toBe(true);
    expect(
      redact({ apiKey: "secret", nested: { accessToken: "token" } }),
    ).toEqual({
      apiKey: "[REDACTED]",
      nested: { accessToken: "[REDACTED]" },
    });
  });

  it("imports xlsx sheets as typed logical tables and rejects legacy xls", async () => {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Customer", "Revenue", "Active"],
        ["Ada", 120, true],
        ["Grace", null, false],
      ]),
      "Sales",
    );
    const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const result = await new ExcelUploadService(storage).upload(
      new File([bytes], "sales.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.sheets[0].name).toBe("Sales");
      expect(
        result.data.sheets[0].columns.map((column) => column.dataType),
      ).toEqual(["string", "number", "boolean"]);
      expect(result.data.rowCount).toBe(2);
    }
    expect(
      (
        await new ExcelUploadService(storage).upload(
          new File([bytes], "legacy.xls", { type: "application/vnd.ms-excel" }),
        )
      ).ok,
    ).toBe(false);
  });
});
