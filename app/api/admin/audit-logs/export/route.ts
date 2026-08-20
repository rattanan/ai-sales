import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { csv, csvResponse } from "@/server/services/csv";
import { failure } from "@/types/result";

export async function GET() {
  try {
    const context = await requireAuthorization();
    await requirePermission(context, "audit.export");
    const logs = await db.auditLog.findMany({
      where: { organizationId: context.organizationId },
      include: { actor: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "AUDIT_LOG_EXPORTED",
        entityType: "AuditLog",
        metadata: { rowCount: logs.length },
      },
    });
    return csvResponse(
      csv([
        [
          "Timestamp",
          "User",
          "Action",
          "Resource type",
          "Resource ID",
          "Resource name",
          "Outcome",
          "IP address",
          "Correlation ID",
          "Before",
          "After",
          "Metadata",
        ],
        ...logs.map((log) => [
          log.createdAt.toISOString(),
          log.actor?.email ?? log.actorName,
          log.action,
          log.entityType,
          log.entityId,
          log.entityName,
          log.outcome,
          log.ipAddress,
          log.correlationId ?? log.requestId,
          JSON.stringify(log.beforeValue),
          JSON.stringify(log.afterValue),
          JSON.stringify(log.metadata),
        ]),
      ]),
      "audit-log.csv",
    );
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You cannot export audit logs."),
      { status: 403 },
    );
  }
}
