import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const aiEndpointSchema = z
  .object({
    endpointId: optionalId,
    kind: z.enum(["CHAT", "EMBEDDING"]),
    providerType: z.enum(["OPENAI_COMPATIBLE", "OLLAMA"]),
    name: z.string().trim().min(2).max(120),
    baseUrl: z.string().url().max(2_000),
    model: z.string().trim().min(1).max(300),
    apiKey: z.string().max(16_000).optional(),
    credentialPresent: z.preprocess(
      (value) => value === true || value === "true" || value === "on",
      z.boolean(),
    ),
    temperature: z.coerce.number().min(0).max(2).optional(),
    maxTokens: z.coerce.number().int().min(128).max(128_000).optional(),
    batchSize: z.coerce.number().int().min(1).max(200).optional(),
    vectorDimension: z.preprocess(
      (value) => (value === "" || value === null ? undefined : value),
      z.coerce.number().int().min(1).max(65_535).optional(),
    ),
    timeoutMs: z.coerce.number().int().min(1_000).max(300_000),
    maxRetries: z.coerce.number().int().min(0).max(5),
    active: z.preprocess(
      (value) => value === true || value === "on",
      z.boolean(),
    ),
  })
  .superRefine((value, context) => {
    if (value.kind === "CHAT" && value.providerType === "OLLAMA")
      context.addIssue({
        code: "custom",
        path: ["providerType"],
        message: "Chat endpoints currently use the OpenAI-compatible contract",
      });
    if (value.kind === "EMBEDDING" && !value.batchSize)
      context.addIssue({
        code: "custom",
        path: ["batchSize"],
        message: "Batch size is required for embedding endpoints",
      });
    if (
      value.kind === "EMBEDDING" &&
      value.providerType === "OPENAI_COMPATIBLE" &&
      /:embedContent$/i.test(value.model)
    )
      context.addIssue({
        code: "custom",
        path: ["model"],
        message:
          "Use the OpenAI-compatible model ID only; remove ':embedContent'. For Gemini, use gemini-embedding-2-preview or gemini-embedding-001.",
      });
  });

export const aiEndpointIdSchema = z.object({
  endpointId: z.string().min(1),
});

export type AiEndpointInput = z.infer<typeof aiEndpointSchema>;
