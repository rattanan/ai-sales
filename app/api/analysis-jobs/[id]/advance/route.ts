import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { db } from "@/server/db";
import { advanceAnalysisJob } from "@/server/services/analysis-job-service";
import { runAnalysisStage } from "@/server/services/analysis-stage-runner";
import { failure } from "@/types/result";

export const maxDuration = 300;

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
    const result = await advanceAnalysisJob(
      authorization,
      id,
      runAnalysisStage,
    );
    return Response.json(result, {
      status: result.ok
        ? 200
        : result.error.code === "NOT_FOUND"
          ? 404
          : result.error.code === "CONFLICT"
            ? 409
            : 422,
    });
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You cannot advance this analysis job."),
      { status: 403 },
    );
  }
}
