import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDataSourceAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { rollbackExcelVersion } from "@/server/services/excel-version";
import { failure, success } from "@/types/result";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    const { id, versionId } = await params;
    const context = await requireAuthorization();
    await requirePermission(context, "excel.replace");
    await requireDataSourceAccess(context, id, "manage");
    return Response.json(
      success(await rollbackExcelVersion(context, id, versionId)),
    );
  } catch {
    return Response.json(
      failure("FORBIDDEN", "This workbook version cannot be restored."),
      { status: 403 },
    );
  }
}
