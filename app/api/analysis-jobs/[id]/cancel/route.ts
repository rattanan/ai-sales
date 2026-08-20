import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { cancelAnalysisJob } from "@/server/services/analysis-job-service";
import { failure } from "@/types/result";

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = await requireAuthorization();
    const { id } = await context.params;
    await requirePermission(authorization, "dashboard.update");
    const job = await db.analysisJob.findFirst({
      where: { id, workspaceId: authorization.workspaceId },
      select: { dashboardId: true },
    });
    if (!job) throw new Error("NOT_FOUND");
    await requireDashboardAccess(authorization, job.dashboardId, "edit");
    const result = await cancelAnalysisJob(authorization, id);
    return Response.json(result, { status: result.ok ? 200 : 409 });
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You cannot cancel this analysis job."),
      { status: 403 },
    );
  }
}
