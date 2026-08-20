import { db } from "@/server/db";
import { redact } from "@/server/services/logger";

export type AuditEvent = {
  organizationId: string;
  workspaceId?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName?: string | null;
  outcome?: string;
  beforeValue?: unknown;
  afterValue?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  errorMessage?: string | null;
  correlationId?: string | null;
  metadata?: unknown;
};

export async function recordAudit(event: AuditEvent) {
  await db.auditLog.create({
    data: {
      ...event,
      beforeValue: event.beforeValue
        ? (redact(event.beforeValue) as object)
        : undefined,
      afterValue: event.afterValue
        ? (redact(event.afterValue) as object)
        : undefined,
      metadata: event.metadata ? (redact(event.metadata) as object) : undefined,
      errorMessage: event.errorMessage?.slice(0, 500),
    },
  });
}
