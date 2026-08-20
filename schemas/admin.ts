import { z } from "zod";

const optionalScopeId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const projectIds = z.array(z.string().min(1)).max(50).default([]);

export const createUserSchema = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  roleId: z.string().min(1),
  temporaryPassword: z.string().min(12).max(128),
  status: z.enum(["PENDING_ACTIVATION", "ACTIVE", "LOCKED", "DISABLED"]),
  forcePasswordChange: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  copilotEnabled: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  organizationUnitId: optionalScopeId,
  projectIds,
});

export const updateUserStatusSchema = z.object({
  userId: z.string().min(1),
  status: z.enum(["ACTIVE", "LOCKED", "DISABLED"]),
});

export const deleteUserSchema = z.object({
  userId: z.string().min(1),
  confirmationEmail: z.string().trim().toLowerCase().email(),
});

export const adminResetPasswordSchema = z.object({
  userId: z.string().min(1),
  temporaryPassword: z.string().min(12).max(128),
});

export const assignRoleSchema = z.object({
  userId: z.string().min(1),
  roleId: z.string().min(1),
});

export const updateUserSchema = z.object({
  userId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email(),
  username: z
    .string()
    .trim()
    .toLowerCase()
    .min(3)
    .max(64)
    .regex(/^[a-z0-9._-]+$/),
  copilotEnabled: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  organizationUnitId: optionalScopeId,
  projectIds,
});

export const organizationScopeSchema = z.object({
  kind: z.enum(["unit", "project"]),
  name: z.string().trim().min(2).max(100),
  code: z
    .string()
    .trim()
    .toUpperCase()
    .min(2)
    .max(32)
    .regex(/^[A-Z0-9_-]+$/),
  description: z.string().trim().max(500).optional(),
});

export const llmProviderSchema = z.object({
  providerId: optionalScopeId,
  name: z.string().trim().min(2).max(100),
  baseUrl: z.string().trim().url(),
  chatModel: z.string().trim().min(1).max(200),
  embeddingModel: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(500).optional(),
  temperature: z.coerce.number().min(0).max(2),
  timeoutMs: z.coerce.number().int().min(1_000).max(300_000),
  maxTokens: z.coerce.number().int().min(128).max(1_000_000),
  active: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  supportsJsonSchema: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  fallbackEnabled: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
});

export const providerIdSchema = z.object({ providerId: z.string().min(1) });

export const privacyPolicySchema = z.object({
  enabled: z.preprocess((value) => value === "on", z.boolean()),
  maskEmail: z.preprocess((value) => value === "on", z.boolean()),
  maskPhone: z.preprocess((value) => value === "on", z.boolean()),
  maskNationalId: z.preprocess((value) => value === "on", z.boolean()),
  maskFinancialAccount: z.preprocess((value) => value === "on", z.boolean()),
  maskPassport: z.preprocess((value) => value === "on", z.boolean()),
  maskHealth: z.preprocess((value) => value === "on", z.boolean()),
  maskReligion: z.preprocess((value) => value === "on", z.boolean()),
  maskBiometric: z.preprocess((value) => value === "on", z.boolean()),
  customMaskTerms: z.preprocess(
    (value) =>
      typeof value === "string"
        ? value
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean)
        : value,
    z.array(z.string().min(2).max(80)).max(50).default([]),
  ),
  allowSensitiveAiAccess: z.preprocess((value) => value === "on", z.boolean()),
  auditLogDays: z.coerce.number().int().min(30).max(3_650),
  loginHistoryDays: z.coerce.number().int().min(30).max(3_650),
  chatHistoryDays: z.coerce.number().int().min(1).max(3_650),
  memoryRetentionDays: z.coerce.number().int().min(1).max(3_650).default(365),
});

export const grantResourceAccessSchema = z.object({
  userId: z.string().min(1),
  resourceType: z.enum(["datasource", "dashboard"]),
  resourceId: z.string().min(1),
  level: z.string().min(1),
  canExport: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
});
