import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { csv, csvResponse } from "@/server/services/csv";
import { failure } from "@/types/result";

export async function GET() {
  try {
    const context = await requireAuthorization();
    await requirePermission(context, "login_history.export");
    const events = await db.loginHistory.findMany({
      where: { organizationId: context.organizationId },
      include: { user: { select: { name: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 10_000,
    });
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "LOGIN_HISTORY_EXPORTED",
        entityType: "LoginHistory",
        metadata: { rowCount: events.length },
      },
    });
    return csvResponse(
      csv([
        [
          "Timestamp",
          "User",
          "Email or username",
          "Status",
          "IP address",
          "Browser",
          "Operating system",
          "Device",
          "Failure reason",
          "Logout time",
        ],
        ...events.map((event) => [
          event.createdAt.toISOString(),
          event.user?.name,
          event.identifier,
          event.status,
          event.ipAddress,
          event.browser,
          event.operatingSystem,
          event.device,
          event.failureReason,
          event.logoutAt?.toISOString(),
        ]),
      ]),
      "login-history.csv",
    );
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You cannot export login history."),
      { status: 403 },
    );
  }
}
