"use server";

import { revalidatePath } from "next/cache";
import { aiEndpointIdSchema, aiEndpointSchema } from "@/schemas/ai-endpoint";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import {
  saveAiEndpoint,
  testAiEndpoint,
} from "@/server/services/ai-endpoint-service";
import { failure } from "@/types/result";

export async function saveAiEndpointAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const parsed = aiEndpointSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the endpoint configuration.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await saveAiEndpoint(context, parsed.data);
  if (result.ok) {
    revalidatePath("/workspace/admin/chat-endpoint");
    revalidatePath("/workspace/admin/embedding-endpoint");
    revalidatePath("/workspace/sources");
  }
  return result;
}

export async function testAiEndpointAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const parsed = aiEndpointIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "AI endpoint is required.");
  const result = await testAiEndpoint(context, parsed.data.endpointId);
  revalidatePath("/workspace/admin/chat-endpoint");
  revalidatePath("/workspace/admin/embedding-endpoint");
  return result;
}
