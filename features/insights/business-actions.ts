"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import { businessInsightFilterSchema } from "@/schemas/business-insight";
import { queueBusinessInsight } from "@/server/services/business-insight-service";
import { failure } from "@/types/result";

export async function createBusinessInsightAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = businessInsightFilterSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the insight filters.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await queueBusinessInsight(context, parsed.data);
  if (result.ok) revalidatePath("/workspace/insights");
  return result;
}
