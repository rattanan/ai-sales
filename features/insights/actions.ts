"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  acknowledgeInsightSchema,
  filteredInsightAnalysisSchema,
} from "@/schemas/dashboard-insights";
import {
  acknowledgeDashboardInsight,
  analyzeFilteredDashboardInsights,
} from "@/server/services/dashboard-insight-service";
import { failure } from "@/types/result";

export async function analyzeFilteredInsightsAction(input: unknown) {
  const parsed = filteredInsightAnalysisSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "The selected filters are invalid.");
  const context = await requireAuthorization();
  return analyzeFilteredDashboardInsights(
    context,
    parsed.data.dashboardId,
    parsed.data.filters,
  );
}

export async function acknowledgeInsightAction(input: unknown) {
  const parsed = acknowledgeInsightSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "The insight could not be acknowledged.",
    );
  const context = await requireAuthorization();
  const result = await acknowledgeDashboardInsight(
    context,
    parsed.data.dashboardId,
    parsed.data.insight,
  );
  if (result.ok)
    revalidatePath(`/workspace/dashboards/${parsed.data.dashboardId}`);
  return result;
}
