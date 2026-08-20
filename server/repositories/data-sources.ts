import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";

export const dataSourceRepository = {
  async list(context: AuthorizationContext) {
    const manageAll = await hasPermission(context, "datasource.update");
    return db.dataSource.findMany({
      where: {
        workspaceId: context.workspaceId,
        ...(manageAll ? {} : { access: { some: { userId: context.userId } } }),
      },
      include: {
        credential: { select: { id: true } },
        file: true,
        _count: { select: { schemas: true, dashboards: true } },
      },
      orderBy: { updatedAt: "desc" },
    });
  },
  async find(context: AuthorizationContext, id: string) {
    const manageAll = await hasPermission(context, "datasource.update");
    return db.dataSource.findFirst({
      where: {
        id,
        workspaceId: context.workspaceId,
        ...(manageAll ? {} : { access: { some: { userId: context.userId } } }),
      },
      include: {
        credential: true,
        file: true,
        schemas: {
          include: { tables: { include: { columns: true } } },
          orderBy: { name: "asc" },
        },
        dashboards: { include: { dashboard: true } },
        excelVersions: {
          include: { sheets: { include: { columns: true } }, uploadedBy: true },
          orderBy: { version: "desc" },
        },
      },
    });
  },
};
