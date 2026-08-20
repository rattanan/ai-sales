import { z } from "zod";

export const insightDisplaySchema = z.object({
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  caveats: z.array(z.string().max(1_000)).max(10),
});

export const filteredInsightAnalysisSchema = z.object({
  dashboardId: z.string().cuid(),
  filters: z
    .record(z.string(), z.array(z.string().max(200)).max(20))
    .default({}),
});

export const acknowledgeInsightSchema = z.object({
  dashboardId: z.string().cuid(),
  insight: insightDisplaySchema,
});
