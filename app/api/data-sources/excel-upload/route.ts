import path from "node:path";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ExcelUploadService } from "@/server/services/excel";
import { LocalObjectStorageService } from "@/server/storage/local-storage";
import { env } from "@/schemas/env";
import { failure, success } from "@/types/result";
import { contentLengthWithinLimit } from "@/server/http/request-security";
import { summarizeDataSourcePreview } from "@/server/services/source-preview-service";

export async function POST(request: Request) {
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
  let storedKey: string | undefined;
  try {
    const context = await requireAuthorization();
    await requirePermission(context, "excel.upload");
    await requirePermission(context, "datasource.create");
    const formData = await request.formData();
    const file = formData.get("file");
    const name = String(formData.get("name") ?? "").trim();
    if (!(file instanceof File) || name.length < 2)
      return Response.json(
        failure(
          "VALIDATION_ERROR",
          "Provide a source name and .xlsx workbook.",
        ),
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
    const storage = new LocalObjectStorageService(
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
    const source = await db.$transaction(async (tx) => {
      const created = await tx.dataSource.create({
        data: {
          workspaceId: context.workspaceId,
          createdById: context.userId,
          name,
          type: "EXCEL",
          status: "CONNECTED",
          lastConnectedAt: new Date(),
          lastDiscoveredAt: new Date(),
          file: {
            create: {
              storageKey: uploaded.data.key,
              originalName: uploaded.data.originalName,
              mimeType:
                uploaded.data.mimeType ||
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
              sizeBytes: uploaded.data.size,
              checksum: uploaded.data.checksum,
              sheetNames: uploaded.data.sheetNames,
            },
          },
          access: {
            create: {
              organizationId: context.organizationId,
              userId: context.userId,
              grantedById: context.userId,
              canPreview: true,
              canBuild: true,
              canManage: true,
            },
          },
        },
      });
      const version = await tx.excelFileVersion.create({
        data: {
          dataSourceId: created.id,
          version: 1,
          storageKey: uploaded.data.key,
          originalName: uploaded.data.originalName,
          mimeType:
            uploaded.data.mimeType ||
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          sizeBytes: uploaded.data.size,
          checksum: uploaded.data.checksum,
          status: "COMPLETED",
          uploadedById: context.userId,
          rowCount: uploaded.data.rowCount,
          sheetCount: uploaded.data.sheets.length,
          isCurrent: true,
          importedAt: new Date(),
          changeSummary: { initialImport: true },
        },
      });
      const logicalSchema = await tx.dataSourceSchema.create({
        data: { dataSourceId: created.id, name: "Workbook", selected: true },
      });
      for (const importedSheet of uploaded.data.sheets) {
        const sheet = await tx.excelSheet.create({
          data: {
            versionId: version.id,
            name: importedSheet.name,
            rowCount: importedSheet.rows.length,
            columnCount: importedSheet.columns.length,
            columns: { createMany: { data: importedSheet.columns } },
          },
        });
        const table = await tx.dataSourceTable.create({
          data: {
            schemaId: logicalSchema.id,
            name: importedSheet.name,
            tableType: "SHEET",
            estimatedRowCount: importedSheet.rows.length,
            selected: true,
            columns: {
              createMany: {
                data: importedSheet.columns.map((column) => ({
                  name: column.name,
                  dataType: column.dataType,
                  ordinal: column.ordinal,
                  nullable: column.nullable,
                })),
              },
            },
          },
        });
        void table;
        for (
          let offset = 0;
          offset < importedSheet.rows.length;
          offset += 1_000
        ) {
          const batch = importedSheet.rows.slice(offset, offset + 1_000);
          await tx.excelSheetRow.createMany({
            data: batch.map((data, index) => ({
              sheetId: sheet.id,
              rowNumber: offset + index + 1,
              data,
              searchText: Object.values(data)
                .filter((value) => value !== null)
                .join(" ")
                .toLowerCase()
                .slice(0, 20_000),
            })),
          });
        }
      }
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "EXCEL_UPLOADED",
          entityType: "DataSource",
          entityId: created.id,
          entityName: created.name,
          metadata: {
            sizeBytes: uploaded.data.size,
            sheets: uploaded.data.sheets.length,
            rows: uploaded.data.rowCount,
            version: 1,
          },
        },
      });
      return created;
    });
    await summarizeDataSourcePreview(context, source.id).catch(() => undefined);
    return Response.json(
      success({ id: source.id, sheetNames: uploaded.data.sheetNames }),
      { status: 201 },
    );
  } catch {
    if (storedKey) {
      const config = env();
      if (config.OBJECT_STORAGE_DRIVER === "local")
        await new LocalObjectStorageService(
          path.resolve(config.LOCAL_STORAGE_PATH),
        )
          .delete(storedKey)
          .catch(() => undefined);
    }
    return Response.json(
      failure("FORBIDDEN", "The workbook could not be imported."),
      { status: 403 },
    );
  }
}
