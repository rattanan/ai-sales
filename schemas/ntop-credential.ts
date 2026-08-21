import { z } from "zod";

export const ntopApiKeySchema = z
  .string()
  .trim()
  .regex(
    /^ntop_[a-f0-9]{12}_[A-Za-z0-9_-]{32,}$/,
    "Enter the API Key generated for this user in NTOP.",
  );

export const optionalNtopApiKeySchema = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  ntopApiKeySchema.optional(),
);
