import { OrganizationRole } from "@/generated/prisma/enums";
import { requireAuthorization } from "@/server/auth/authorization";
import { requireDashboardAccess } from "@/server/auth/permissions";
import { analysisJobRepository } from "@/server/repositories/analysis-jobs";
import { analysisJobSummary } from "@/server/services/analysis-job-service";
import { failure, success } from "@/types/result";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const authorization = await requireAuthorization(OrganizationRole.VIEWER);
    const { id } = await context.params;
    const job = await analysisJobRepository.find(authorization, id);
    if (!job)
      return Response.json(failure("NOT_FOUND", "Analysis job not found."), {
        status: 404,
      });
    await requireDashboardAccess(authorization, job.dashboardId, "view");
    return Response.json(success(analysisJobSummary(job)));
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You do not have access to this analysis job."),
      { status: 403 },
    );
  }
}
