import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import {
  configuredNtopClientForUser,
  NtopApiError,
} from "@/server/integrations/ntop/client";
import {
  ntopActionTool,
  requireConfirmedNtopWrite,
} from "@/server/integrations/ntop/tools";
import { failure, success } from "@/types/result";

function record(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function confirmNtopAction(
  context: AuthorizationContext,
  actionId: string,
) {
  const action = await db.ntopActionProposal.findFirst({
    where: {
      id: actionId,
      organizationId: context.organizationId,
      userId: context.userId,
    },
  });
  if (!action) return failure("NOT_FOUND", "Suggested action not found.");
  if (action.status === "COMPLETED") return success(action);
  if (action.status !== "PENDING")
    return failure(
      "CONFLICT",
      `This action is already ${action.status.toLowerCase()}.`,
    );
  if (action.expiresAt <= new Date()) {
    await db.ntopActionProposal.update({
      where: { id: action.id },
      data: { status: "EXPIRED" },
    });
    return failure("CONFLICT", "This suggested action has expired.");
  }
  const client = await configuredNtopClientForUser(context.userId);
  if (!client)
    return failure(
      "CONNECTION_FAILED",
      "Add your personal NTOP API Key in Profile before confirming a write action.",
    );
  const claimed = await db.ntopActionProposal.updateMany({
    where: { id: action.id, status: "PENDING" },
    data: { status: "EXECUTING", confirmedAt: new Date() },
  });
  if (claimed.count !== 1)
    return failure("CONFLICT", "This action is already being processed.");
  const payload = record(action.payload);
  try {
    requireConfirmedNtopWrite(ntopActionTool[action.type], true);
    const result =
      action.type === "CREATE_PROSPECT"
        ? await client.createProspect(payload, action.idempotencyKey)
        : action.type === "CREATE_LEAD"
          ? await client.createLead(payload, action.idempotencyKey)
          : action.type === "CREATE_OPPORTUNITY"
            ? await client.createOpportunity(payload, action.idempotencyKey)
            : action.type === "CREATE_QUOTATION"
              ? await client.createQuotation(payload, action.idempotencyKey)
              : await client.updateOpportunity(
                  String(payload.id ?? ""),
                  Number(payload.version),
                  record(payload.data as Prisma.JsonValue),
                  action.idempotencyKey,
                );
    const completed = await db.$transaction(async (tx) => {
      const updated = await tx.ntopActionProposal.update({
        where: { id: action.id },
        data: {
          status: "COMPLETED",
          result: result as Prisma.InputJsonValue,
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "NTOP_ACTION_CONFIRMED",
          entityType: "NtopActionProposal",
          entityId: action.id,
          outcome: "SUCCESS",
          metadata: { type: action.type },
        },
      });
      return updated;
    });
    return success(completed);
  } catch (error) {
    const code =
      error instanceof NtopApiError ? error.code : "NTOP_WRITE_FAILED";
    const message =
      error instanceof Error
        ? error.message
        : "NTOP could not complete the action.";
    await db.$transaction([
      db.ntopActionProposal.update({
        where: { id: action.id },
        data: { status: "FAILED", errorCode: code, errorMessage: message },
      }),
      db.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "NTOP_ACTION_CONFIRMED",
          entityType: "NtopActionProposal",
          entityId: action.id,
          outcome: "FAILED",
          metadata: { type: action.type, errorCode: code },
        },
      }),
    ]);
    return failure("CONNECTION_FAILED", message);
  }
}

export async function cancelNtopAction(
  context: AuthorizationContext,
  actionId: string,
) {
  const cancelled = await db.ntopActionProposal.updateMany({
    where: {
      id: actionId,
      organizationId: context.organizationId,
      userId: context.userId,
      status: "PENDING",
    },
    data: { status: "CANCELLED" },
  });
  return cancelled.count === 1
    ? success({ id: actionId, status: "CANCELLED" as const })
    : failure("CONFLICT", "The action cannot be cancelled.");
}
