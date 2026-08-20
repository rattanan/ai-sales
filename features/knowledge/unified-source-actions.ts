"use server";

import { revalidatePath } from "next/cache";
import {
  copiedTextSourceSchema,
  sourceAssignmentSchema,
} from "@/schemas/knowledge";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import {
  archiveKnowledgeSource,
  saveCopiedTextSource,
  updateSourceAssignment,
} from "@/server/services/unified-source-service";
import { failure } from "@/types/result";

export async function saveCopiedTextSourceAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const parsed = copiedTextSourceSchema.safeParse({
    ...Object.fromEntries(formData),
    tags: String(formData.get("tags") ?? "")
      .split(/[,\n]/)
      .map((item) => item.trim())
      .filter(Boolean),
    botIds: formData.getAll("botIds"),
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the copied text source.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await saveCopiedTextSource(context, parsed.data);
  if (result.ok) {
    revalidatePath("/workspace/sources");
    revalidatePath("/workspace/admin/knowledge/sources");
  }
  return result;
}

export async function archiveKnowledgeSourceAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await archiveKnowledgeSource(context, id);
  revalidatePath("/workspace/sources");
  revalidatePath("/workspace/admin/knowledge/sources");
}

export async function updateSourceAssignmentAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = sourceAssignmentSchema.safeParse({
    ...Object.fromEntries(formData),
    botIds: formData.getAll("botIds"),
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the source assignment.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  await requirePermission(context, "bot.manage");
  await requirePermission(
    context,
    parsed.data.sourceType === "KNOWLEDGE"
      ? "knowledge.manage"
      : parsed.data.sourceType === "DATABASE"
        ? "datasource.update"
        : "legacy_api.manage",
  );
  const result = await updateSourceAssignment(context, parsed.data);
  if (result.ok) {
    revalidatePath("/workspace/sources");
    revalidatePath("/workspace/admin/bots");
    revalidatePath("/workspace/admin/knowledge/access");
  }
  return result;
}
