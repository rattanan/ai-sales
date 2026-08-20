"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  memoryConsentSchema,
  memoryIdSchema,
  userMemorySchema,
} from "@/schemas/memory";
import {
  changeMemoryConsent,
  deleteAllUserMemories,
  deleteUserMemory,
  saveUserMemory,
} from "@/server/services/user-memory-service";
import { failure } from "@/types/result";

function categories(formData: FormData) {
  return formData.getAll("categories").map(String);
}

export async function saveUserMemoryAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = userMemorySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the memory fields.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await saveUserMemory(context, parsed.data);
  if (result.ok) revalidatePath("/workspace/profile/memory");
  return result;
}

export async function changeMemoryConsentAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  const parsed = memoryConsentSchema.safeParse({
    ...Object.fromEntries(formData),
    categories: categories(formData),
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Select a valid consent scope.");
  const result = await changeMemoryConsent(context, parsed.data);
  if (result.ok) revalidatePath("/workspace/profile/memory");
  return result;
}

export async function deleteUserMemoryAction(formData: FormData) {
  const context = await requireAuthorization();
  const parsed = memoryIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await deleteUserMemory(context, parsed.data.id);
  revalidatePath("/workspace/profile/memory");
}

export async function deleteAllUserMemoriesAction(formData: FormData) {
  const context = await requireAuthorization();
  if (formData.get("confirm") !== "DELETE ALL MEMORIES") return;
  await deleteAllUserMemories(context);
  revalidatePath("/workspace/profile/memory");
}
