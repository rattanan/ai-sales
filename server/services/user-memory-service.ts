import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import type { UserMemoryCategory } from "@/generated/prisma/enums";
import type { z } from "zod";
import type { memoryConsentSchema, userMemorySchema } from "@/schemas/memory";
import { isLikelySensitive } from "./sensitive-data";
import { failure, success } from "@/types/result";

type MemoryInput = z.infer<typeof userMemorySchema>;
type ConsentInput = z.infer<typeof memoryConsentSchema>;

const SECRET_ASSIGNMENT =
  /(?:password|passcode|secret|token|credential|api[_ -]?key|authorization|private[_ -]?key)\s*[:=]/i;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/i;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const PRIVATE_KEY = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export function containsProhibitedMemory(key: string, value: string) {
  return (
    isLikelySensitive(key, value) ||
    isLikelySensitive("value", value) ||
    SECRET_ASSIGNMENT.test(`${key}:${value}`) ||
    BEARER.test(value) ||
    JWT.test(value) ||
    PRIVATE_KEY.test(value)
  );
}

async function scopedBot(context: AuthorizationContext, botId?: string) {
  if (!botId) return true;
  try {
    await requireBotUse(context, botId);
    return true;
  } catch {
    return false;
  }
}

async function latestConsent(context: AuthorizationContext, botId?: string) {
  return db.memoryConsent.findFirst({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      OR: [{ botId: botId ?? null }, { botId: null }],
    },
    orderBy: { createdAt: "desc" },
  });
}

async function valueMatchesOrganizationScope(
  context: AuthorizationContext,
  category: UserMemoryCategory,
  value: string,
) {
  if (category === "PREFERENCE") return true;
  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: context.organizationId,
        userId: context.userId,
      },
    },
    include: {
      organizationUnit: true,
      projects: { include: { project: true } },
    },
  });
  const normalized = value.trim().toLocaleLowerCase();
  if (category === "DEPARTMENT")
    return Boolean(
      membership?.organizationUnit &&
      [
        membership.organizationUnit.id,
        membership.organizationUnit.code,
        membership.organizationUnit.name,
      ].some((candidate) => candidate.toLocaleLowerCase() === normalized),
    );
  return Boolean(
    membership?.projects.some(({ project }) =>
      [project.id, project.code, project.name].some(
        (candidate) => candidate.toLocaleLowerCase() === normalized,
      ),
    ),
  );
}

export async function saveUserMemory(
  context: AuthorizationContext,
  input: MemoryInput,
) {
  if (!(await scopedBot(context, input.botId)))
    return failure("NOT_FOUND", "Bot not found.");
  if (containsProhibitedMemory(input.key, input.value))
    return failure(
      "VALIDATION_ERROR",
      "Passwords, tokens, credentials, personal identifiers, contact details, financial data, and opaque secrets cannot be stored as memory.",
    );
  const consent = await latestConsent(context, input.botId);
  if (
    consent?.status !== "GRANTED" ||
    !consent.categories.includes(input.category)
  )
    return failure(
      "FORBIDDEN",
      "Grant consent for this memory category before saving it.",
    );
  if (
    !(await valueMatchesOrganizationScope(context, input.category, input.value))
  )
    return failure(
      "VALIDATION_ERROR",
      "Department and project memories must match your assigned organization scope.",
    );
  const [retention, existing] = await Promise.all([
    db.systemRetentionPolicy.findUnique({
      where: { organizationId: context.organizationId },
    }),
    db.userMemory.findFirst({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        ...(input.id
          ? { id: input.id }
          : {
              botId: input.botId ?? null,
              category: input.category,
              key: input.key,
            }),
      },
    }),
  ]);
  if (input.id && !existing) return failure("NOT_FOUND", "Memory not found.");
  const expiresAt = new Date(
    Date.now() + (retention?.memoryRetentionDays ?? 365) * 24 * 60 * 60 * 1_000,
  );
  const memory = existing
    ? await db.userMemory.update({
        where: { id: existing.id },
        data: {
          botId: input.botId ?? null,
          category: input.category,
          key: input.key,
          value: input.value,
          expiresAt,
        },
      })
    : await db.userMemory.create({
        data: {
          organizationId: context.organizationId,
          userId: context.userId,
          botId: input.botId,
          category: input.category,
          key: input.key,
          value: input.value,
          sourceMessageIds: [],
          expiresAt,
        },
      });
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: existing ? "USER_MEMORY_UPDATED" : "USER_MEMORY_CREATED",
      entityType: "UserMemory",
      entityId: memory.id,
      outcome: "SUCCESS",
      metadata: {
        category: memory.category,
        botId: memory.botId,
        expiresAt: memory.expiresAt,
      },
    },
  });
  return success({ id: memory.id, expiresAt: memory.expiresAt });
}

export async function changeMemoryConsent(
  context: AuthorizationContext,
  input: ConsentInput,
) {
  if (!(await scopedBot(context, input.botId)))
    return failure("NOT_FOUND", "Bot not found.");
  const consent = await db.$transaction(async (tx) => {
    const created = await tx.memoryConsent.create({
      data: {
        organizationId: context.organizationId,
        userId: context.userId,
        botId: input.botId,
        status: input.status,
        categories: input.categories,
        reason: input.reason,
        changedById: context.userId,
      },
    });
    let deletedCount = 0;
    if (input.status === "REVOKED") {
      const deleted = await tx.userMemory.deleteMany({
        where: {
          organizationId: context.organizationId,
          userId: context.userId,
          ...(input.botId ? { botId: input.botId } : {}),
          category: { in: input.categories },
        },
      });
      deletedCount = deleted.count;
    }
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action:
          input.status === "GRANTED"
            ? "MEMORY_CONSENT_GRANTED"
            : "MEMORY_CONSENT_REVOKED",
        entityType: "MemoryConsent",
        entityId: created.id,
        outcome: "SUCCESS",
        metadata: {
          botId: input.botId ?? null,
          categories: input.categories,
          deletedMemoryCount: deletedCount,
          policyVersion: created.policyVersion,
        },
      },
    });
    return { created, deletedCount };
  });
  return success({
    id: consent.created.id,
    status: consent.created.status,
    deletedMemoryCount: consent.deletedCount,
  });
}

export async function deleteUserMemory(
  context: AuthorizationContext,
  id: string,
) {
  const deleted = await db.userMemory.deleteMany({
    where: {
      id,
      organizationId: context.organizationId,
      userId: context.userId,
    },
  });
  if (!deleted.count) return failure("NOT_FOUND", "Memory not found.");
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "USER_MEMORY_DELETED",
      entityType: "UserMemory",
      entityId: id,
      outcome: "SUCCESS",
    },
  });
  return success({ id, deleted: true as const });
}

export async function deleteAllUserMemories(context: AuthorizationContext) {
  const deleted = await db.userMemory.deleteMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
    },
  });
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "USER_MEMORY_DELETE_REQUEST_COMPLETED",
      entityType: "UserMemory",
      outcome: "SUCCESS",
      metadata: { deletedCount: deleted.count },
    },
  });
  return success({ deletedCount: deleted.count });
}

export async function getActiveUserMemories(
  context: AuthorizationContext,
  botId: string,
) {
  const consent = await latestConsent(context, botId);
  if (consent?.status !== "GRANTED") return [];
  await db.userMemory.deleteMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      expiresAt: { lte: new Date() },
    },
  });
  return db.userMemory.findMany({
    where: {
      organizationId: context.organizationId,
      userId: context.userId,
      expiresAt: { gt: new Date() },
      category: { in: consent.categories },
      OR: [{ botId }, { botId: null }],
    },
    orderBy: [{ category: "asc" }, { updatedAt: "desc" }],
    take: 30,
  });
}
