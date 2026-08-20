"use server";

import { revalidatePath } from "next/cache";
import {
  resourceIdSchema,
  sharedFolderSourceSchema,
  webSourceSchema,
} from "@/schemas/knowledge";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import {
  cancelIndexJob,
  createSharedFolderSource,
  createWebSource,
  reindexSource,
  retryIndexJob,
  startSourceRefresh,
} from "@/server/services/source-operations";
import { failure } from "@/types/result";

function refreshOperationsViews(sourceId?: string) {
  revalidatePath("/workspace/sources");
  revalidatePath("/workspace/admin/knowledge");
  revalidatePath("/workspace/admin/knowledge/sources");
  revalidatePath("/workspace/admin/knowledge/index-jobs");
  if (sourceId)
    revalidatePath(`/workspace/admin/knowledge/sources/${sourceId}`);
}

export async function createSharedFolderSourceAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const parsed = sharedFolderSourceSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the shared-folder settings.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await createSharedFolderSource(context, parsed.data);
  if (result.ok) refreshOperationsViews();
  return result;
}

export async function createWebSourceAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const parsed = webSourceSchema.safeParse({
    ...Object.fromEntries(formData),
    allowedDomains: String(formData.get("allowedDomains") ?? "")
      .split(/[\n,]/)
      .map((value) => value.trim())
      .filter(Boolean),
  });
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the web-source settings.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const result = await createWebSource(context, parsed.data);
  if (result.ok) refreshOperationsViews();
  return result;
}

async function authorizedContext() {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  return context;
}

export async function refreshSourceAction(formData: FormData) {
  const context = await authorizedContext();
  const parsed = resourceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await startSourceRefresh(context, parsed.data.id);
  refreshOperationsViews();
}

export async function retryIndexJobAction(formData: FormData) {
  const context = await authorizedContext();
  const parsed = resourceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await retryIndexJob(context, parsed.data.id);
  refreshOperationsViews();
}

export async function cancelIndexJobAction(formData: FormData) {
  const context = await authorizedContext();
  const parsed = resourceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  await cancelIndexJob(context, parsed.data.id);
  refreshOperationsViews();
}

export async function reindexSourceAction(formData: FormData) {
  await reindexSourceWithFeedbackAction(null, formData);
}

export async function reindexSourceWithFeedbackAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await authorizedContext();
  const parsed = resourceIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Knowledge source is invalid.");
  const result = await reindexSource(context, parsed.data.id);
  if (result.ok) refreshOperationsViews(parsed.data.id);
  return result;
}
