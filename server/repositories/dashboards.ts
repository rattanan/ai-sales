import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";

export const dashboardRepository = {
  async list(context: AuthorizationContext) {
    const admin = await hasPermission(context, "role.manage");
    return db.dashboard.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(admin
          ? {}
          : {
              OR: [
                { createdById: context.userId },
                { access: { some: { userId: context.userId } } },
              ],
            }),
      },
      include: {
        dataSources: {
          include: {
            dataSource: {
              include: { access: { where: { userId: context.userId } } },
            },
          },
        },
        access: { where: { userId: context.userId } },
        analysisJobs: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" as const },
          take: 1,
          select: { requestSnapshot: true },
        },
        _count: { select: { versions: true, widgets: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  },
  async find(context: AuthorizationContext, id: string) {
    const admin = await hasPermission(context, "role.manage");
    return db.dashboard.findFirst({
      where: {
        id,
        workspaceId: context.workspaceId,
        ...(admin
          ? {}
          : {
              OR: [
                { createdById: context.userId },
                { access: { some: { userId: context.userId } } },
              ],
            }),
      },
      include: {
        dataSources: {
          include: {
            dataSource: {
              include: { access: { where: { userId: context.userId } } },
            },
          },
        },
        access: { where: { userId: context.userId } },
        versions: { orderBy: { version: "desc" } },
        widgets: { orderBy: { position: "asc" } },
        analysisJobs: {
          where: { status: "COMPLETED" },
          orderBy: { completedAt: "desc" as const },
          take: 1,
          select: { requestSnapshot: true },
        },
      },
    });
  },
};
