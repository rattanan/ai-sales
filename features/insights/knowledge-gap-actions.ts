"use server";

import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { failure, success } from "@/types/result";

async function canAccessConversation(
  context: Awaited<ReturnType<typeof requireAuthorization>>,
  conversation: {
    userId: string;
    organizationUnitId: string | null;
    projectId: string | null;
  },
) {
  if (conversation.userId === context.userId) return true;
  const [audit, admin, membership] = await Promise.all([
    hasPermission(context, "chat.audit"),
    hasPermission(context, "role.manage"),
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      include: { projects: true },
    }),
  ]);
  if (!audit) return false;
  if (admin) return true;
  return Boolean(
    (membership?.organizationUnitId &&
      membership.organizationUnitId === conversation.organizationUnitId) ||
    (conversation.projectId &&
      membership?.projects.some(
        ({ projectId }) => projectId === conversation.projectId,
      )),
  );
}

export async function createKnowledgeGapAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "insight.manage");
  const messageId = String(formData.get("messageId") ?? "");
  const assistant = await db.chatMessage.findFirst({
    where: {
      id: messageId,
      role: "ASSISTANT",
      conversation: { organizationId: context.organizationId, deletedAt: null },
    },
    include: {
      conversation: {
        include: {
          messages: {
            where: { role: "USER" },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (
    !assistant ||
    !(await canAccessConversation(context, assistant.conversation))
  )
    return failure("NOT_FOUND", "Unanswered message not found.");
  const question = [...assistant.conversation.messages]
    .reverse()
    .find(({ createdAt }) => createdAt <= assistant.createdAt);
  if (!question) return failure("NOT_FOUND", "Related question not found.");
  const existing = await db.knowledgeGap.findFirst({
    where: {
      workspaceId: context.workspaceId,
      evidenceMessageIds: { has: assistant.id },
    },
  });
  if (existing) return success({ id: existing.id, created: false as const });
  const gap = await db.knowledgeGap.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      title: question.content.slice(0, 120),
      question: question.content,
      evidenceMessageIds: [question.id, assistant.id],
    },
  });
  revalidatePath("/workspace/analytics/knowledge-gaps");
  return success({ id: gap.id, created: true as const });
}

export async function createKnowledgeGapFormAction(formData: FormData) {
  await createKnowledgeGapAction(formData);
}

export async function updateKnowledgeGapAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "insight.manage");
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "OPEN");
  const assigneeId = String(formData.get("assigneeId") ?? "") || null;
  const gap = await db.knowledgeGap.findFirst({
    where: {
      id,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    },
  });
  if (!gap) return failure("NOT_FOUND", "Knowledge gap not found.");
  const evidence = await db.chatMessage.findFirst({
    where: {
      id: { in: gap.evidenceMessageIds },
      conversation: { organizationId: context.organizationId, deletedAt: null },
    },
    include: { conversation: true },
  });
  if (
    !evidence ||
    !(await canAccessConversation(context, evidence.conversation))
  )
    return failure("NOT_FOUND", "Knowledge gap not found.");
  if (assigneeId) {
    const validAssignee = await db.organizationMember.count({
      where: { organizationId: context.organizationId, userId: assigneeId },
    });
    if (!validAssignee)
      return failure(
        "VALIDATION_ERROR",
        "Assignee is outside the organization.",
      );
  }
  await db.$transaction([
    db.knowledgeGap.update({
      where: { id: gap.id },
      data: {
        assigneeId,
        status,
        resolvedAt: status === "RESOLVED" ? new Date() : null,
        resolutionSourceType:
          String(formData.get("resolutionSourceType") ?? "") || null,
        resolutionSourceId:
          String(formData.get("resolutionSourceId") ?? "") || null,
      },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "KNOWLEDGE_GAP_UPDATED",
        entityType: "KnowledgeGap",
        entityId: gap.id,
        outcome: "SUCCESS",
        metadata: { status, assigneeId },
      },
    }),
  ]);
  revalidatePath("/workspace/analytics/knowledge-gaps");
  return success({ updated: true as const });
}

export async function updateKnowledgeGapFormAction(formData: FormData) {
  await updateKnowledgeGapAction(formData);
}
