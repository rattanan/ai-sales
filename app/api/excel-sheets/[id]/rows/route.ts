import { requireAuthorization } from "@/server/auth/authorization";
import { requireDataSourceAccess } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { failure, success } from "@/types/result";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const context = await requireAuthorization();
    const sheet = await db.excelSheet.findFirst({
      where: {
        id,
        version: { dataSource: { workspaceId: context.workspaceId } },
      },
      include: {
        version: { select: { dataSourceId: true } },
        columns: { orderBy: { ordinal: "asc" } },
      },
    });
    if (!sheet)
      return Response.json(failure("NOT_FOUND", "Sheet not found."), {
        status: 404,
      });
    await requireDataSourceAccess(
      context,
      sheet.version.dataSourceId,
      "preview",
    );
    const url = new URL(request.url);
    const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
    const pageSize = Math.min(
      100,
      Math.max(10, Number(url.searchParams.get("pageSize")) || 50),
    );
    const search = url.searchParams.get("search")?.trim().toLowerCase();
    const where = {
      sheetId: id,
      ...(search ? { searchText: { contains: search } } : {}),
    };
    const [rows, total] = await Promise.all([
      db.excelSheetRow.findMany({
        where,
        orderBy: { rowNumber: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: { rowNumber: true, data: true },
      }),
      db.excelSheetRow.count({ where }),
    ]);
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "EXCEL_DATA_PREVIEWED",
        entityType: "ExcelSheet",
        entityId: id,
        entityName: sheet.name,
        metadata: {
          page,
          pageSize,
          rowsReturned: rows.length,
          filtered: Boolean(search),
        },
      },
    });
    return Response.json(
      success({ rows, total, page, pageSize, columns: sheet.columns }),
    );
  } catch {
    return Response.json(
      failure("FORBIDDEN", "You do not have access to this sheet."),
      { status: 403 },
    );
  }
}
