"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  llmProviderSchema,
  organizationScopeSchema,
  privacyPolicySchema,
  providerIdSchema,
} from "@/schemas/admin";
import { failure, success } from "@/types/result";
import {
  llmProviderEncryption,
  testLlmProvider,
} from "@/server/services/llm-provider-config";
import { recordAudit } from "@/server/services/audit";

export async function createOrganizationScopeAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(
    context,
    formData.get("kind") === "project"
      ? "project.manage"
      : "organization.manage",
  );
  const parsed = organizationScopeSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the scope name and code.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  try {
    const created =
      parsed.data.kind === "unit"
        ? await db.organizationUnit.create({
            data: {
              organizationId: context.organizationId,
              name: parsed.data.name,
              code: parsed.data.code,
              description: parsed.data.description,
            },
          })
        : await db.organizationProject.create({
            data: {
              organizationId: context.organizationId,
              name: parsed.data.name,
              code: parsed.data.code,
              description: parsed.data.description,
            },
          });
    await recordAudit({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action:
        parsed.data.kind === "unit"
          ? "ORGANIZATION_UNIT_CREATED"
          : "PROJECT_CREATED",
      entityType:
        parsed.data.kind === "unit"
          ? "OrganizationUnit"
          : "OrganizationProject",
      entityId: created.id,
      entityName: created.name,
      afterValue: { name: created.name, code: created.code },
    });
    revalidatePath("/workspace/admin/scopes");
    return success({ id: created.id });
  } catch {
    return failure(
      "CONFLICT",
      "A scope with this name or code already exists.",
    );
  }
}

export async function toggleOrganizationScopeAction(formData: FormData) {
  const context = await requireAuthorization();
  const id = String(formData.get("id") ?? "");
  const kind = formData.get("kind") === "project" ? "project" : "unit";
  const active = formData.get("active") === "true";
  await requirePermission(
    context,
    kind === "project" ? "project.manage" : "organization.manage",
  );
  if (!id) return;
  const updated =
    kind === "unit"
      ? await db.organizationUnit.updateMany({
          where: { id, organizationId: context.organizationId },
          data: { active },
        })
      : await db.organizationProject.updateMany({
          where: { id, organizationId: context.organizationId },
          data: { active },
        });
  if (updated.count)
    await recordAudit({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: active
        ? "ORGANIZATION_SCOPE_ENABLED"
        : "ORGANIZATION_SCOPE_DISABLED",
      entityType: kind === "unit" ? "OrganizationUnit" : "OrganizationProject",
      entityId: id,
      afterValue: { active },
    });
  revalidatePath("/workspace/admin/scopes");
}

export async function saveLlmProviderAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const parsed = llmProviderSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the provider configuration.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const existing = parsed.data.providerId
    ? await db.llmProvider.findFirst({
        where: {
          id: parsed.data.providerId,
          organizationId: context.organizationId,
        },
        include: { credential: { select: { id: true } } },
      })
    : null;
  if (parsed.data.providerId && !existing)
    return failure("NOT_FOUND", "Provider not found.");
  if (!parsed.data.apiKey && !existing?.credential)
    return failure(
      "VALIDATION_ERROR",
      "API key is required for a new provider.",
    );
  try {
    const provider = await db.$transaction(async (tx) => {
      if (parsed.data.active)
        await tx.llmProvider.updateMany({
          where: { organizationId: context.organizationId },
          data: { active: false },
        });
      const data = {
        name: parsed.data.name,
        baseUrl: parsed.data.baseUrl,
        chatModel: parsed.data.chatModel,
        embeddingModel: parsed.data.embeddingModel,
        temperature: parsed.data.temperature,
        timeoutMs: parsed.data.timeoutMs,
        maxTokens: parsed.data.maxTokens,
        active: parsed.data.active,
        supportsJsonSchema: parsed.data.supportsJsonSchema,
        fallbackEnabled: parsed.data.fallbackEnabled,
      };
      const saved = existing
        ? await tx.llmProvider.update({ where: { id: existing.id }, data })
        : await tx.llmProvider.create({
            data: {
              ...data,
              organization: { connect: { id: context.organizationId } },
            },
          });
      if (parsed.data.apiKey) {
        const encrypted = llmProviderEncryption().encrypt(parsed.data.apiKey);
        await tx.llmProviderCredential.upsert({
          where: { providerId: saved.id },
          update: encrypted,
          create: { providerId: saved.id, ...encrypted },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: existing ? "LLM_PROVIDER_UPDATED" : "LLM_PROVIDER_CREATED",
          entityType: "LlmProvider",
          entityId: saved.id,
          entityName: saved.name,
          beforeValue: existing
            ? { name: existing.name, active: existing.active }
            : undefined,
          afterValue: {
            name: saved.name,
            baseUrl: saved.baseUrl,
            chatModel: saved.chatModel,
            embeddingModel: saved.embeddingModel,
            active: saved.active,
            apiKeyConfigured: Boolean(
              parsed.data.apiKey || existing?.credential,
            ),
          },
        },
      });
      return saved;
    });
    revalidatePath("/workspace/admin/providers");
    revalidatePath("/workspace/admin/system-health");
    return success({ id: provider.id });
  } catch {
    return failure("CONFLICT", "A provider with this name already exists.");
  }
}

export async function testLlmProviderAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const parsed = providerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Provider is required.");
  try {
    const result = await testLlmProvider(
      parsed.data.providerId,
      context.organizationId,
    );
    await recordAudit({
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "LLM_PROVIDER_TESTED",
      entityType: "LlmProvider",
      entityId: parsed.data.providerId,
      outcome: result.healthy ? "SUCCESS" : "FAILED",
      metadata: { healthy: result.healthy, message: result.message },
    });
    revalidatePath("/workspace/admin/providers");
    revalidatePath("/workspace/admin/system-health");
    return result.healthy
      ? success({ message: result.message })
      : failure("CONNECTION_FAILED", result.message);
  } catch {
    return failure("CONNECTION_FAILED", "Provider connection test failed.");
  }
}

export async function deleteLlmProviderAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const parsed = providerIdSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const provider = await db.llmProvider.findFirst({
    where: {
      id: parsed.data.providerId,
      organizationId: context.organizationId,
    },
  });
  if (!provider) return;
  await db.llmProvider.delete({ where: { id: provider.id } });
  await recordAudit({
    organizationId: context.organizationId,
    workspaceId: context.workspaceId,
    actorId: context.userId,
    action: "LLM_PROVIDER_DELETED",
    entityType: "LlmProvider",
    entityId: provider.id,
    entityName: provider.name,
  });
  revalidatePath("/workspace/admin/providers");
}

export async function savePrivacyPolicyAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "privacy.manage");
  await requirePermission(context, "system.retention.manage");
  const parsed = privacyPolicySchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Check the privacy and retention values.",
      {
        fieldErrors: parsed.error.flatten().fieldErrors,
      },
    );
  const {
    auditLogDays,
    loginHistoryDays,
    chatHistoryDays,
    memoryRetentionDays,
    customMaskTerms,
    ...privacy
  } = parsed.data;
  await db.$transaction(async (tx) => {
    await tx.piiMaskingPolicy.upsert({
      where: { organizationId: context.organizationId },
      update: { ...privacy, customPatterns: customMaskTerms },
      create: {
        organizationId: context.organizationId,
        ...privacy,
        customPatterns: customMaskTerms,
      },
    });
    await tx.systemRetentionPolicy.upsert({
      where: { organizationId: context.organizationId },
      update: {
        auditLogDays,
        loginHistoryDays,
        chatHistoryDays,
        memoryRetentionDays,
      },
      create: {
        organizationId: context.organizationId,
        auditLogDays,
        loginHistoryDays,
        chatHistoryDays,
        memoryRetentionDays,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "PRIVACY_RETENTION_UPDATED",
        entityType: "SystemConfiguration",
        afterValue: {
          ...privacy,
          customMaskTermCount: customMaskTerms.length,
          auditLogDays,
          loginHistoryDays,
          chatHistoryDays,
          memoryRetentionDays,
        },
      },
    });
  });
  revalidatePath("/workspace/admin/privacy");
  return success({ updated: true });
}
