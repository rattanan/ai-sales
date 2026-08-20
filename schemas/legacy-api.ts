import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);
const headerNameSchema = z
  .string()
  .trim()
  .regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/)
  .max(128);
const forbiddenHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "cookie",
  "set-cookie",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);
const secretHeaderName =
  /^(authorization|proxy-authorization|x-api-key|api-key|apikey|.*(?:secret|token|credential|password).*)$/i;

function containsSecretTemplateKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretTemplateKey);
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(
    ([key, item]) =>
      /(?:secret|token|credential|password|api[_-]?key|authorization)/i.test(
        key,
      ) || containsSecretTemplateKey(item),
  );
}

export const legacyApiParameterSchema = z.object({
  name: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  label: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  location: z.enum(["PATH", "QUERY", "BODY"]),
  type: z.enum(["STRING", "NUMBER", "BOOLEAN"]),
  required: z.boolean(),
  defaultValue: scalarSchema.optional(),
});

export const legacyApiRegistrySchema = z
  .object({
    legacyApiId: optionalId,
    credentialPresent: z.preprocess(
      (value) => value === true || value === "true" || value === "on",
      z.boolean(),
    ),
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().min(10).max(2_000),
    baseUrl: z.string().url().max(2_000),
    endpointPath: z
      .string()
      .trim()
      .min(1)
      .max(1_000)
      .refine(
        (value) =>
          value.startsWith("/") &&
          !value.startsWith("//") &&
          !/[\\?#]/.test(value),
        "Endpoint must be a fixed relative path without query or fragment",
      ),
    method: z.enum(["GET", "POST"]),
    readOnlyConfirmed: z.preprocess(
      (value) => value === true || value === "on",
      z.boolean(),
    ),
    enabled: z.preprocess(
      (value) => value === true || value === "on",
      z.boolean(),
    ),
    allowedDomains: z.array(z.string().trim().min(1).max(253)).min(1).max(20),
    timeoutMs: z.coerce.number().int().min(1_000).max(60_000),
    maxResponseBytes: z.coerce.number().int().min(1_024).max(10_485_760),
    maxRedirects: z.coerce.number().int().min(0).max(5),
    requestHeaders: z
      .record(headerNameSchema, z.string().max(2_000))
      .refine(
        (headers) =>
          Object.entries(headers).every(
            ([name, value]) =>
              !forbiddenHeaders.has(name.toLowerCase()) &&
              !secretHeaderName.test(name) &&
              !/[\r\n]/.test(value),
          ),
        "A request header is forbidden or contains a line break",
      ),
    parameters: z.array(legacyApiParameterSchema).max(30),
    bodyTemplate: z.unknown().nullable(),
    responseSchema: z.record(z.string(), z.unknown()),
    responseMapping: z.record(z.string(), z.string().trim().min(1).max(500)),
    authType: z.enum([
      "NONE",
      "API_KEY",
      "QUERY_API_KEY",
      "BEARER",
      "BASIC",
      "CUSTOM_HEADER",
    ]),
    apiKeyHeaderName: headerNameSchema.optional(),
    apiKey: z.string().max(8_000).optional(),
    queryApiKeyName: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9_.-]{0,127}$/)
      .optional(),
    queryApiKey: z.string().trim().max(8_000).optional(),
    bearerToken: z.string().max(16_000).optional(),
    basicUsername: z.string().max(1_000).optional(),
    basicPassword: z.string().max(8_000).optional(),
    customHeaderName: headerNameSchema.optional(),
    customHeaderValue: z.string().max(8_000).optional(),
  })
  .superRefine((value, context) => {
    if (value.authType !== "NONE" && !value.baseUrl.startsWith("https://"))
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "Authenticated API operations require HTTPS",
      });
    const authHeaderName =
      value.authType === "API_KEY"
        ? value.apiKeyHeaderName
        : value.authType === "CUSTOM_HEADER"
          ? value.customHeaderName
          : undefined;
    if (authHeaderName && forbiddenHeaders.has(authHeaderName.toLowerCase()))
      context.addIssue({
        code: "custom",
        path:
          value.authType === "API_KEY"
            ? ["apiKeyHeaderName"]
            : ["customHeaderName"],
        message: "The authentication header name is not allowed",
      });
    if (value.method !== "GET" && !value.readOnlyConfirmed)
      context.addIssue({
        code: "custom",
        path: ["readOnlyConfirmed"],
        message: "Non-GET operations require explicit read-only confirmation",
      });
    if (
      value.method === "GET" &&
      value.parameters.some((item) => item.location === "BODY")
    )
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "GET parameters cannot target the request body",
      });
    if (value.method === "GET" && value.bodyTemplate != null)
      context.addIssue({
        code: "custom",
        path: ["bodyTemplate"],
        message: "GET operations cannot define a request body",
      });
    if (containsSecretTemplateKey(value.bodyTemplate))
      context.addIssue({
        code: "custom",
        path: ["bodyTemplate"],
        message:
          "Static credentials are not allowed in body templates; use encrypted authentication fields",
      });
    const names = value.parameters.map((item) => item.name);
    if (new Set(names).size !== names.length)
      context.addIssue({
        code: "custom",
        path: ["parameters"],
        message: "Parameter names must be unique",
      });
    for (const parameter of value.parameters.filter(
      (item) => item.location === "PATH",
    ))
      if (!value.endpointPath.includes(`{${parameter.name}}`))
        context.addIssue({
          code: "custom",
          path: ["endpointPath"],
          message: `Missing path placeholder for ${parameter.name}`,
        });
    const needsCredential =
      value.authType !== "NONE" && !value.credentialPresent;
    if (
      needsCredential &&
      value.authType === "API_KEY" &&
      (!value.apiKey || !value.apiKeyHeaderName)
    )
      context.addIssue({
        code: "custom",
        path: ["apiKey"],
        message: "API key and header name are required",
      });
    if (
      needsCredential &&
      value.authType === "QUERY_API_KEY" &&
      (!value.queryApiKey || !value.queryApiKeyName)
    )
      context.addIssue({
        code: "custom",
        path: ["queryApiKey"],
        message: "API key and query parameter name are required",
      });
    if (needsCredential && value.authType === "BEARER" && !value.bearerToken)
      context.addIssue({
        code: "custom",
        path: ["bearerToken"],
        message: "Bearer token is required",
      });
    if (
      needsCredential &&
      value.authType === "BASIC" &&
      (!value.basicUsername || !value.basicPassword)
    )
      context.addIssue({
        code: "custom",
        path: ["basicPassword"],
        message: "Basic username and password are required",
      });
    if (
      needsCredential &&
      value.authType === "CUSTOM_HEADER" &&
      (!value.customHeaderName || !value.customHeaderValue)
    )
      context.addIssue({
        code: "custom",
        path: ["customHeaderValue"],
        message: "Custom header name and value are required",
      });
  });

export const legacyApiInvocationInputSchema = z.object({
  legacyApiId: z.string().min(1),
  botId: z.string().min(1).optional(),
  question: z.string().trim().min(1).max(2_000),
  parameters: z.record(z.string(), scalarSchema).default({}),
});

export const legacyApiIdSchema = z.object({ id: z.string().min(1) });

export const legacyApiToolPlanSchema = z
  .object({
    intent: z.enum(["API", "OTHER", "CLARIFICATION"]),
    apiId: z.string().nullable(),
    parameters: z.record(z.string(), scalarSchema),
    clarification: z.string().trim().min(1).max(1_000).nullable(),
    reason: z.string().trim().min(1).max(1_000),
  })
  .superRefine((value, context) => {
    if (value.intent === "API" && !value.apiId)
      context.addIssue({
        code: "custom",
        path: ["apiId"],
        message: "API ID is required",
      });
    if (value.intent === "CLARIFICATION" && !value.clarification)
      context.addIssue({
        code: "custom",
        path: ["clarification"],
        message: "Clarification is required",
      });
  });

export const legacyApiSummarySchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  limitations: z.array(z.string().trim().min(1).max(500)).max(10),
});

export const legacyApiAiDefinitionSchema = z.object({
  toolName: z
    .string()
    .trim()
    .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/),
  toolDescription: z.string().trim().min(10).max(2_000),
  whenToUse: z.string().trim().min(10).max(2_000),
  inputJsonSchema: z.record(z.string(), z.unknown()),
  outputJsonSchema: z.record(z.string(), z.unknown()),
});

export type LegacyApiParameter = z.infer<typeof legacyApiParameterSchema>;
export type LegacyApiRegistryInput = z.infer<typeof legacyApiRegistrySchema>;
