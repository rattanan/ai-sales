import { z } from "zod";

const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();

export const ntopSalesIntentSchema = z.strictObject({
  intent: z.enum([
    "NONE",
    "LOOKUP",
    "CREATE_PROSPECT",
    "CREATE_LEAD",
    "CREATE_OPPORTUNITY",
    "UPDATE_OPPORTUNITY",
    "CREATE_QUOTATION",
  ]),
  company: nullableText(255),
  contactName: nullableText(255),
  contactEmail: z.string().trim().email().nullable(),
  contactPhone: nullableText(100),
  requirement: nullableText(10_000),
  solution: nullableText(10_000),
  estimatedValue: z
    .string()
    .regex(/^\d+(\.\d{1,4})?$/)
    .nullable(),
  expectedCloseDate: z.string().datetime().nullable(),
  opportunityId: nullableText(191),
  quotationId: nullableText(191),
});

export type NtopSalesIntent = z.infer<typeof ntopSalesIntentSchema>;

export type NtopSuggestedAction = {
  id: string;
  type:
    | "CREATE_PROSPECT"
    | "CREATE_LEAD"
    | "CREATE_OPPORTUNITY"
    | "UPDATE_OPPORTUNITY"
    | "CREATE_QUOTATION";
  status:
    "PENDING" | "EXECUTING" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED";
  title: string;
  summary: string;
  expiresAt: string;
  errorMessage?: string | null;
};
