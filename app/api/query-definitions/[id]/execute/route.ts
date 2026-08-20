import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { executeQueryDefinition } from "@/server/services/query-service";
import { failure } from "@/types/result";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = await requireAuthorization();
    const { id } = await context.params;
    await requirePermission(authorization, "dashboard.update");
    const query = await db.queryDefinition.findFirst({
      where: { id, analysisJob: { workspaceId: authorization.workspaceId } },
      select: { analysisJob: { select: { dashboardId: true } } },
    });
    if (!query) throw new Error("NOT_FOUND");
    await requireDashboardAccess(
      authorization,
      query.analysisJob.dashboardId,
      "edit",
    );
    const result = await executeQueryDefinition(authorization, id);
    return Response.json(result, { status: result.ok ? 200 : 422 });
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You cannot execute this query definition."),
      { status: 403 },
    );
  }
}
