import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import type { ImportedExcelSheet, UploadedWorkbook } from "./excel";
import { db } from "@/server/db";
import { summarizeDataSourcePreview } from "./source-preview-service";

async function rebuildLogicalMetadata(
  tx: Prisma.TransactionClient,
  dataSourceId: string,
  sheets: ImportedExcelSheet[],
) {
  await tx.dataSourceSchema.deleteMany({ where: { dataSourceId } });
  const logicalSchema = await tx.dataSourceSchema.create({
    data: { dataSourceId, name: "Workbook", selected: true },
  });
  for (const sheet of sheets) {
    await tx.dataSourceTable.create({
      data: {
        schemaId: logicalSchema.id,
        name: sheet.name,
        tableType: "SHEET",
        estimatedRowCount: sheet.rows.length,
        selected: true,
        columns: {
          createMany: {
            data: sheet.columns.map((column) => ({
              name: column.name,
              dataType: column.dataType,
              ordinal: column.ordinal,
              nullable: column.nullable,
            })),
          },
        },
      },
    });
  }
}

function compareSchemas(
  previous: { name: string; columns: { name: string; ordinal: number }[] }[],
  next: ImportedExcelSheet[],
) {
  const previousMap = new Map(previous.map((sheet) => [sheet.name, sheet]));
  const nextMap = new Map(next.map((sheet) => [sheet.name, sheet]));
  const addedSheets = next
    .filter((sheet) => !previousMap.has(sheet.name))
    .map((sheet) => sheet.name);
  const removedSheets = previous
    .filter((sheet) => !nextMap.has(sheet.name))
    .map((sheet) => sheet.name);
  const columns = next.flatMap((sheet) => {
    const old = previousMap.get(sheet.name);
    if (!old) return [];
    const oldNames = new Set(old.columns.map((column) => column.name));
    const newNames = new Set(sheet.columns.map((column) => column.name));
    const added = sheet.columns
      .filter((column) => !oldNames.has(column.name))
      .map((column) => column.name);
    const removed = old.columns
      .filter((column) => !newNames.has(column.name))
      .map((column) => column.name);
    const renamed = removed.flatMap((from) => {
      const oldColumn = old.columns.find((column) => column.name === from);
      const to = sheet.columns.find(
        (column) =>
          column.ordinal === oldColumn?.ordinal && added.includes(column.name),
      );
      return to ? [{ from, to: to.name }] : [];
    });
    return added.length || removed.length
      ? [{ sheet: sheet.name, added, removed, renamed }]
      : [];
  });
  return {
    addedSheets,
    removedSheets,
    columns,
    schemaChanged: Boolean(
      addedSheets.length || removedSheets.length || columns.length,
    ),
  };
}

export async function replaceExcelVersion(
  context: AuthorizationContext,
  dataSourceId: string,
  uploaded: UploadedWorkbook,
) {
  const source = await db.dataSource.findFirst({
    where: {
      id: dataSourceId,
      workspaceId: context.workspaceId,
      type: "EXCEL",
    },
    include: {
      file: true,
      excelVersions: {
        where: { isCurrent: true },
        include: { sheets: { include: { columns: true } } },
        take: 1,
      },
      _count: { select: { excelVersions: true } },
    },
  });
  if (!source?.file) throw new Error("NOT_FOUND");
  const previous = source.excelVersions[0];
  const changes = compareSchemas(previous?.sheets ?? [], uploaded.sheets);
  const result = await db.$transaction(async (tx) => {
    await tx.excelFileVersion.updateMany({
      where: { dataSourceId, isCurrent: true },
      data: { isCurrent: false },
    });
    const version = await tx.excelFileVersion.create({
      data: {
        dataSourceId,
        version: source._count.excelVersions + 1,
        storageKey: uploaded.key,
        originalName: uploaded.originalName,
        mimeType:
          uploaded.mimeType ||
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        sizeBytes: uploaded.size,
        checksum: uploaded.checksum,
        status: "COMPLETED",
        uploadedById: context.userId,
        changeSummary: changes,
        warningSummary: changes.schemaChanged
          ? { affectedDashboardsRequireReview: true }
          : undefined,
        rowCount: uploaded.rowCount,
        sheetCount: uploaded.sheets.length,
        isCurrent: true,
        importedAt: new Date(),
      },
    });
    for (const importedSheet of uploaded.sheets) {
      const sheet = await tx.excelSheet.create({
        data: {
          versionId: version.id,
          name: importedSheet.name,
          rowCount: importedSheet.rows.length,
          columnCount: importedSheet.columns.length,
          columns: { createMany: { data: importedSheet.columns } },
        },
      });
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
    await rebuildLogicalMetadata(tx, dataSourceId, uploaded.sheets);
    await tx.dataSourceFile.update({
      where: { dataSourceId },
      data: {
        storageKey: uploaded.key,
        originalName: uploaded.originalName,
        mimeType: uploaded.mimeType,
        sizeBytes: uploaded.size,
        checksum: uploaded.checksum,
        sheetNames: uploaded.sheetNames,
      },
    });
    if (changes.schemaChanged)
      await tx.dashboard.updateMany({
        where: { dataSources: { some: { dataSourceId } } },
        data: { hasSchemaWarning: true },
      });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "EXCEL_REPLACED",
        entityType: "DataSource",
        entityId: dataSourceId,
        entityName: source.name,
        metadata: { version: version.version, ...changes },
      },
    });
    return { version: version.version, changes };
  });
  await summarizeDataSourcePreview(context, dataSourceId).catch(
    () => undefined,
  );
  return result;
}

export async function rollbackExcelVersion(
  context: AuthorizationContext,
  dataSourceId: string,
  versionId: string,
) {
  const version = await db.excelFileVersion.findFirst({
    where: {
      id: versionId,
      dataSourceId,
      status: "COMPLETED",
      dataSource: { workspaceId: context.workspaceId },
    },
    include: {
      sheets: {
        include: {
          columns: { orderBy: { ordinal: "asc" } },
          rows: { orderBy: { rowNumber: "asc" } },
        },
      },
      dataSource: { select: { name: true } },
    },
  });
  if (!version || version.isCurrent) throw new Error("NOT_FOUND");
  const sheets: ImportedExcelSheet[] = version.sheets.map((sheet) => ({
    name: sheet.name,
    columns: sheet.columns.map((column) => ({
      name: column.name,
      dataType: column.dataType,
      ordinal: column.ordinal,
      nullable: column.nullable,
    })),
    rows: sheet.rows.map(
      (row) => row.data as Record<string, string | number | boolean | null>,
    ),
  }));
  await db.$transaction(async (tx) => {
    await tx.excelFileVersion.updateMany({
      where: { dataSourceId, isCurrent: true },
      data: { isCurrent: false },
    });
    await tx.excelFileVersion.update({
      where: { id: version.id },
      data: { isCurrent: true },
    });
    await rebuildLogicalMetadata(tx, dataSourceId, sheets);
    await tx.dataSourceFile.update({
      where: { dataSourceId },
      data: {
        storageKey: version.storageKey,
        originalName: version.originalName,
        mimeType: version.mimeType,
        sizeBytes: version.sizeBytes,
        checksum: version.checksum,
        sheetNames: version.sheets.map((sheet) => sheet.name),
      },
    });
    await tx.dashboard.updateMany({
      where: { dataSources: { some: { dataSourceId } } },
      data: { hasSchemaWarning: true },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "EXCEL_VERSION_ROLLED_BACK",
        entityType: "DataSource",
        entityId: dataSourceId,
        entityName: version.dataSource.name,
        metadata: { restoredVersion: version.version },
      },
    });
  });
  return { version: version.version };
}
