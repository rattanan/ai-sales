import { z } from "zod";

const optionalId = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

export const businessInsightFilterSchema = z
  .object({
    dateFrom: z.coerce.date(),
    dateTo: z.coerce.date(),
    botId: optionalId,
    organizationUnitId: optionalId,
    projectId: optionalId,
    userId: optionalId,
  })
  .refine((value) => value.dateFrom <= value.dateTo, {
    path: ["dateTo"],
    message: "End date must be on or after start date",
  })
  .refine(
    (value) =>
      value.dateTo.getTime() - value.dateFrom.getTime() <=
      366 * 24 * 60 * 60 * 1_000,
    { path: ["dateTo"], message: "Date range cannot exceed 366 days" },
  );

export const businessInsightIdSchema = z.object({ id: z.string().min(1) });

export const chatAuditReasonSchema = z.object({
  reason: z.string().trim().min(10).max(500),
  query: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
