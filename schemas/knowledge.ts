import { z } from "zod";
import { isStandardBotIconPath, STANDARD_BOT_ICON_IDS } from "@/lib/bot-icons";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const botAssetPath =
  /^\/api\/bots\/[^/]+\/assets\/[a-f0-9-]{36}\.(?:jpg|png|webp)$/;

export const botConfigurationSchema = z.object({
  botId: optionalId,
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  avatarUrl: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .refine(
        (value) =>
          botAssetPath.test(value) ||
          isStandardBotIconPath(value) ||
          z.string().url().safeParse(value).success,
        "Enter a valid URL",
      )
      .optional(),
  ),
  systemPrompt: z.string().trim().min(20).max(8_000),
  welcomeMessage: z.string().trim().min(2).max(1_000),
  suggestedQuestions: z.array(z.string().trim().min(2).max(300)).max(8),
  active: z.preprocess((value) => value === "on", z.boolean()),
  fallbackMessage: z.string().trim().max(1_000).optional(),
  apiToolsEnabled: z.preprocess((value) => value === "on", z.boolean()),
  databaseToolsEnabled: z.preprocess((value) => value === "on", z.boolean()),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  headerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  chatBubbleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(["system", "sans", "serif", "mono"]),
  colorMode: z.enum(["LIGHT", "DARK", "AUTO"]),
  launcherIcon: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z
      .string()
      .refine(
        (value) =>
          botAssetPath.test(value) ||
          isStandardBotIconPath(value) ||
          z.string().url().safeParse(value).success,
        "Enter a valid URL",
      )
      .optional(),
  ),
  widgetSize: z.enum(["COMPACT", "STANDARD", "LARGE"]),
  launcherSize: z.coerce.number().int().min(40).max(80),
  windowPosition: z.enum(["LEFT", "RIGHT"]),
  placeholder: z.string().trim().min(2).max(200),
  brandingEnabled: z.preprocess((value) => value === "on", z.boolean()),
  providerId: optionalId,
  chatEndpointId: optionalId,
  model: z.string().trim().max(200).optional(),
  temperature: z.coerce.number().min(0).max(2),
  maxTokens: z.coerce.number().int().min(128).max(32_000),
  contextSize: z.coerce.number().int().min(1_000).max(100_000),
  citationEnabled: z.preprocess((value) => value === "on", z.boolean()),
  memoryMode: z.enum(["NONE", "CONVERSATION", "USER_CONSENTED"]),
  rackIds: z.array(z.string().min(1)).max(50),
  dataSourceIds: z.array(z.string().min(1)).max(20),
  legacyApiIds: z.array(z.string().min(1)).max(20),
  roleIds: z.array(z.string().min(1)).max(50),
  userIds: z.array(z.string().min(1)).max(200),
});

export const botAppearanceSchema = z.object({
  botId: z.string().min(1),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  headerColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  chatBubbleColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  fontFamily: z.enum(["system", "sans", "serif", "mono"]),
  colorMode: z.enum(["LIGHT", "DARK", "AUTO"]),
  widgetSize: z.enum(["COMPACT", "STANDARD", "LARGE"]),
  launcherSize: z.coerce.number().int().min(40).max(80),
  windowPosition: z.enum(["LEFT", "RIGHT"]),
  brandingEnabled: z.preprocess((value) => value === "on", z.boolean()),
  avatarStandardIcon: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(STANDARD_BOT_ICON_IDS).optional(),
  ),
  launcherStandardIcon: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.enum(STANDARD_BOT_ICON_IDS).optional(),
  ),
  removeAvatar: z.preprocess((value) => value === "on", z.boolean()),
  removeLauncherIcon: z.preprocess((value) => value === "on", z.boolean()),
});

export const knowledgeRackSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(500).optional(),
  roleIds: z.array(z.string().min(1)).max(50),
  accessLevel: z.enum(["READ", "UPLOAD", "MANAGE"]),
  scope: z.enum(["GLOBAL", "SELECTED_BOTS"]).default("SELECTED_BOTS"),
  botIds: z.array(z.string().min(1)).max(200).default([]),
});

export const knowledgeFolderAccessSchema = z
  .object({
    rackId: z.string().min(1),
    scope: z.enum(["GLOBAL", "SELECTED_BOTS"]),
    botIds: z.array(z.string().min(1)).max(200),
  })
  .superRefine((value, context) => {
    if (value.scope === "SELECTED_BOTS" && !value.botIds.length)
      context.addIssue({
        code: "custom",
        path: ["botIds"],
        message: "Select at least one bot",
      });
  });

export const resourceIdSchema = z.object({ id: z.string().min(1) });

const scheduleFields = {
  scheduleEnabled: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  intervalMinutes: z.coerce.number().int().min(5).max(10_080),
};

export const sharedFolderSourceSchema = z.object({
  rackId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  rootPath: z.string().trim().min(1).max(2_000),
  includeSubdirectories: z.preprocess(
    (value) => value === "on" || value === true,
    z.boolean(),
  ),
  maxFiles: z.coerce.number().int().min(1).max(100_000),
  ...scheduleFields,
});

export const webSourceSchema = z.object({
  rackId: z.string().min(1),
  name: z.string().trim().min(2).max(100),
  url: z.string().url().max(2_000),
  allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(50),
  timeoutMs: z.coerce.number().int().min(1_000).max(60_000),
  maxBytes: z.coerce.number().int().min(1_024).max(26_214_400),
  maxRedirects: z.coerce.number().int().min(0).max(5),
  ...scheduleFields,
});

export const copiedTextSourceSchema = z.object({
  sourceId: optionalId,
  rackId: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(2_000).optional(),
  content: z.string().trim().min(20).max(1_000_000),
  category: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(80)).max(30),
  scope: z.enum(["GLOBAL", "SELECTED_BOTS"]),
  botIds: z.array(z.string().min(1)).max(200),
});

export const sourceAssignmentSchema = z
  .object({
    sourceType: z.enum(["KNOWLEDGE", "DATABASE", "API_TOOL"]),
    sourceId: z.string().min(1),
    scope: z.enum(["GLOBAL", "SELECTED_BOTS"]),
    botIds: z.array(z.string().min(1)).max(200),
    enabled: z.preprocess(
      (value) => value === true || value === "true" || value === "on",
      z.boolean(),
    ),
    priority: z.coerce.number().int().min(1).max(1000),
  })
  .superRefine((value, context) => {
    if (value.scope === "SELECTED_BOTS" && !value.botIds.length)
      context.addIssue({
        code: "custom",
        path: ["botIds"],
        message: "Select at least one bot",
      });
  });

export const indexJobFilterSchema = z.object({
  status: z
    .enum([
      "QUEUED",
      "PROCESSING",
      "CANCEL_REQUESTED",
      "CANCELLED",
      "COMPLETED",
      "FAILED",
      "DEAD_LETTER",
    ])
    .optional(),
  sourceId: z.string().min(1).optional(),
});

export const chatRequestSchema = z.object({
  botId: z.string().min(1),
  conversationId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  message: z.string().trim().min(1).max(8_000),
});

export const universalChatRequestSchema = z
  .object({
    botId: z.string().min(1).optional(),
    conversationId: z.string().min(1).optional(),
    message: z.string().trim().min(1).max(8_000),
    scope: z.enum([
      "SMART",
      "ALL_ACCESSIBLE",
      "SPECIFIC_BOT",
      "SPECIFIC_SOURCES",
      "DOCUMENTS",
      "DATABASES",
      "API_TOOLS",
      "CONVERSATION_HISTORY",
      "BUSINESS_INSIGHT",
    ]),
    mode: z.enum([
      "AUTO",
      "ASK",
      "SEARCH",
      "ANALYZE",
      "SUMMARIZE",
      "GENERATE_REPORT",
      "QUERY_LIVE_DATA",
    ]),
    sourceIds: z.array(z.string().min(1)).max(100).default([]),
  })
  .superRefine((value, context) => {
    if (value.scope === "SPECIFIC_BOT" && !value.botId)
      context.addIssue({
        code: "custom",
        path: ["botId"],
        message: "Select a bot for Specific Bot scope",
      });
    if (value.scope === "SPECIFIC_SOURCES" && !value.sourceIds.length)
      context.addIssue({
        code: "custom",
        path: ["sourceIds"],
        message: "Select at least one source",
      });
  });

export const conversationMutationSchema = z.object({
  conversationId: z.string().min(1),
  title: z.string().trim().min(2).max(120).optional(),
});

export const messageFeedbackSchema = z.object({
  messageId: z.string().min(1),
  rating: z.coerce
    .number()
    .int()
    .refine((value) => value === -1 || value === 1),
  comment: z.string().trim().max(1_000).optional(),
  reason: z
    .enum([
      "CORRECT",
      "CLEAR",
      "MISSING_INFORMATION",
      "INCORRECT",
      "OUTDATED",
      "OTHER",
    ])
    .optional(),
});
