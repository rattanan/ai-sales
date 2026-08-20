import { z } from "zod";

export const copilotPromptSchema = z.object({
  dashboardId: z.string().cuid(),
  prompt: z.string().trim().min(1).max(4_000),
  selectedWidgetId: z.string().cuid().optional(),
  filters: z
    .record(z.string(), z.array(z.string().max(200)).max(20))
    .default({}),
});

export type CopilotPrompt = z.infer<typeof copilotPromptSchema>;

export const copilotChartTypes = [
  "BAR_CHART",
  "HORIZONTAL_BAR_CHART",
  "STACKED_BAR_CHART",
  "LINE_CHART",
  "AREA_CHART",
  "PIE_CHART",
  "DONUT_CHART",
  "GAUGE",
  "TABLE",
] as const;

export type CopilotChartType = (typeof copilotChartTypes)[number];
