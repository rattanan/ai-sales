import path from "node:path";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDataSourceAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { env } from "@/schemas/env";
import { ExcelUploadService } from "@/server/services/excel";
import { replaceExcelVersion } from "@/server/services/excel-version";
import { LocalObjectStorageService } from "@/server/storage/local-storage";
import { failure, success } from "@/types/result";
import { contentLengthWithinLimit } from "@/server/http/request-security";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (
    !contentLengthWithinLimit(
      request,
      env().MAX_EXCEL_UPLOAD_BYTES + 64 * 1_024,
    )
  )
    return Response.json(
      failure("FILE_INVALID", "Upload exceeds the size limit."),
      { status: 413 },
    );
  let storage: LocalObjectStorageService | undefined;
  let storedKey: string | undefined;
  try {
    const { id } = await params;
    const context = await requireAuthorization();
    await requirePermission(context, "excel.replace");
    await requireDataSourceAccess(context, id, "manage");
    const file = (await request.formData()).get("file");
    if (!(file instanceof File))
      return Response.json(
        failure("VALIDATION_ERROR", "Choose an .xlsx workbook."),
        { status: 422 },
      );
    const config = env();
    if (config.OBJECT_STORAGE_DRIVER !== "local")
      return Response.json(
        failure(
          "CONNECTOR_NOT_IMPLEMENTED",
          "The configured object-storage adapter is unavailable.",
        ),
        { status: 501 },
      );
    storage = new LocalObjectStorageService(
      path.resolve(config.LOCAL_STORAGE_PATH),
    );
    const uploaded = await new ExcelUploadService(
      storage,
      config.MAX_EXCEL_UPLOAD_BYTES,
      config.MAX_EXCEL_IMPORT_ROWS,
      config.MAX_EXCEL_SHEETS,
    ).upload(file);
    if (!uploaded.ok) return Response.json(uploaded, { status: 422 });
    storedKey = uploaded.data.key;
    const result = await replaceExcelVersion(context, id, uploaded.data);
    return Response.json(success(result), { status: 201 });
  } catch {
    if (storage && storedKey)
      await storage.delete(storedKey).catch(() => undefined);
    return Response.json(
      failure("FORBIDDEN", "The workbook version could not be imported."),
      { status: 403 },
    );
  }
}
