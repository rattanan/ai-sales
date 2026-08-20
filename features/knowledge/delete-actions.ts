"use server";

import { revalidatePath } from "next/cache";
import { deleteKnowledgeResourceSchema } from "@/schemas/knowledge-deletion";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import {
  deleteKnowledgeFolder,
  deleteKnowledgeSource,
} from "@/server/services/unified-source-service";
import { failure } from "@/types/result";
import type { AppResult } from "@/types/result";

type DeleteResult = AppResult<{ deleted: true; id: string }>;

function invalidDeleteInput() {
  return failure(
    "VALIDATION_ERROR",
    "Enter the exact name to confirm deletion.",
    { fieldErrors: { confirmationName: ["Enter the exact name."] } },
  );
}

export async function deleteKnowledgeSourceAction(
  _previous: DeleteResult | null,
  formData: FormData,
): Promise<DeleteResult> {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const parsed = deleteKnowledgeResourceSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return invalidDeleteInput();
  try {
    const result = await deleteKnowledgeSource(
      context,
      parsed.data.id,
      parsed.data.confirmationName,
    );
    if (result.ok) {
      revalidatePath("/workspace/admin/knowledge");
      revalidatePath("/workspace/admin/knowledge/access");
      revalidatePath("/workspace/sources");
    }
    return result;
  } catch {
    return failure("INTERNAL_ERROR", "The source could not be deleted.");
  }
}

export async function deleteKnowledgeFolderAction(
  _previous: DeleteResult | null,
  formData: FormData,
): Promise<DeleteResult> {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const parsed = deleteKnowledgeResourceSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return invalidDeleteInput();
  try {
    const result = await deleteKnowledgeFolder(
      context,
      parsed.data.id,
      parsed.data.confirmationName,
    );
    if (result.ok) {
      revalidatePath("/workspace/admin/knowledge");
      revalidatePath("/workspace/admin/knowledge/access");
      revalidatePath("/workspace/sources");
    }
    return result;
  } catch {
    return failure("INTERNAL_ERROR", "The folder could not be deleted.");
  }
}
