import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";

export const analysisJobRepository = {
  find(context: AuthorizationContext, id: string) {
    return db.analysisJob.findFirst({
      where: { id, workspaceId: context.workspaceId },
      include: {
        artifacts: { orderBy: [{ type: "asc" }, { revision: "desc" }] },
        recommendations: { orderBy: { createdAt: "asc" } },
        queryDefinitions: {
          include: {
            recommendation: { select: { payload: true } },
            executions: { orderBy: { createdAt: "desc" }, take: 1 },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
  },
  latestForDashboard(context: AuthorizationContext, dashboardId: string) {
    return db.analysisJob.findFirst({
      where: { dashboardId, workspaceId: context.workspaceId },
      orderBy: { createdAt: "desc" },
    });
  },
};
