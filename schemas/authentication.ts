import { z } from "zod";

const checkbox = z.preprocess(
  (value) => value === "on" || value === true,
  z.boolean(),
);

export const authenticationPolicyFormSchema = z
  .object({
    localEnabled: checkbox,
    externalApiEnabled: checkbox,
    embeddedEnabled: checkbox,
    modePriority: z
      .array(z.enum(["EMBEDDED", "EXTERNAL_API", "LOCAL"]))
      .length(3)
      .refine((items) => new Set(items).size === 3),
    signatureMode: z.enum(["HMAC_SHA256", "JWT_HS256", "BOTH"]),
    allowedOrigins: z.array(z.string().url()).max(100),
    replayWindowSeconds: z.coerce.number().int().min(30).max(900),
    sessionTtlSeconds: z.coerce.number().int().min(300).max(86_400),
    externalUrl: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().url().optional(),
    ),
    externalMethod: z.enum(["GET", "POST", "PUT"]),
    externalTimeoutMs: z.coerce.number().int().min(500).max(30_000),
    externalHeaders: z.record(z.string(), z.string()).default({}),
    secretHeaderName: z.string().trim().max(100).optional(),
    secretHeaderValue: z.string().max(4_000).optional(),
    requestUsernameField: z.string().trim().min(1).max(100),
    requestPasswordField: z.string().trim().min(1).max(100),
    responseSuccessPath: z.string().trim().min(1).max(200),
    responseExternalUserIdPath: z.string().trim().min(1).max(200),
    responseUsernamePath: z.string().trim().max(200).optional(),
    responseNamePath: z.string().trim().max(200).optional(),
    responseRolePath: z.string().trim().min(1).max(200),
    responseDepartmentPath: z.string().trim().max(200).optional(),
  })
  .refine(
    (value) =>
      value.localEnabled || value.externalApiEnabled || value.embeddedEnabled,
    { message: "At least one authentication mode must remain enabled." },
  )
  .refine((value) => !value.externalApiEnabled || Boolean(value.externalUrl), {
    message: "External Authentication API URL is required when enabled.",
  });

export const externalAuthTestSchema = z.object({
  username: z.string().trim().min(1).max(200),
  password: z.string().min(1).max(1_000),
});

export const embeddedIdentityPayloadSchema = z
  .object({
    externalUserId: z.string().trim().min(1).max(200).optional(),
    username: z.string().trim().min(1).max(200).optional(),
    name: z.string().trim().min(1).max(200).optional(),
    sessionId: z.string().trim().min(8).max(200),
    role: z.string().trim().min(1).max(100),
    department: z.string().trim().min(1).max(100).optional(),
    timestamp: z.coerce.number().int().positive(),
    nonce: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/),
    origin: z.string().url(),
  })
  .refine((value) => Boolean(value.externalUserId || value.username), {
    message: "externalUserId or username is required.",
  });

export const embeddedSessionRequestSchema = z.object({
  botId: z.string().min(1),
  hostOrigin: z.string().url(),
  payload: embeddedIdentityPayloadSchema.optional(),
  signature: z.string().min(16).max(1_000).optional(),
  token: z.string().min(32).max(20_000).optional(),
});

export const embeddedChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
});

const resourceTypeSchema = z.enum([
  "BOT",
  "KNOWLEDGE_RACK",
  "KNOWLEDGE_SOURCE",
  "DOCUMENT",
  "DATA_SOURCE",
  "DATABASE_SCHEMA",
  "DATABASE_TABLE",
  "LEGACY_API",
  "CHAT",
  "INSIGHT",
]);
const resourceAccessLevelSchema = z.enum(["VIEW", "USE", "EDIT", "MANAGE"]);

export const resourceAclFormSchema = z
  .object({
    resourceType: resourceTypeSchema,
    resourceId: z.string().trim().min(1).max(500),
    userId: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    roleId: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().min(1).optional(),
    ),
    effect: z.enum(["ALLOW", "DENY"]),
    accessLevel: resourceAccessLevelSchema,
  })
  .refine(
    (value) =>
      Number(Boolean(value.userId)) + Number(Boolean(value.roleId)) === 1,
    {
      message: "Choose exactly one user or role principal.",
    },
  );

export const accessSimulationSchema = z.object({
  userId: z.string().min(1),
  resourceType: resourceTypeSchema,
  resourceId: z.string().trim().min(1).max(500),
  accessLevel: resourceAccessLevelSchema,
});
