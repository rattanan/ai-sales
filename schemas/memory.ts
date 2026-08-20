import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const memoryCategorySchema = z.enum([
  "PREFERENCE",
  "DEPARTMENT",
  "PROJECT",
]);

export const userMemorySchema = z.object({
  id: optionalId,
  botId: optionalId,
  category: memoryCategorySchema,
  key: z
    .string()
    .trim()
    .min(2)
    .max(80)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u),
  value: z.string().trim().min(1).max(500),
});

export const memoryConsentSchema = z.object({
  botId: optionalId,
  status: z.enum(["GRANTED", "REVOKED"]),
  categories: z.array(memoryCategorySchema).min(1).max(3),
  reason: z.string().trim().max(500).optional(),
});

export const memoryIdSchema = z.object({ id: z.string().min(1) });
