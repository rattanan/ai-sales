import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requireDataSourceAccess } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { hasPermission } from "@/server/auth/permissions";
import { ReplaceWorkbookForm } from "@/components/excel/replace-workbook-form";
import { RollbackVersionButton } from "@/components/excel/rollback-version-button";

export default async function ExcelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sheet?: string; page?: string; q?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const context = await requireAuthorization();
  const source = await db.dataSource.findFirst({
    where: { id, workspaceId: context.workspaceId, type: "EXCEL" },
    include: {
      createdBy: { select: { name: true } },
      excelVersions: {
        include: {
          uploadedBy: { select: { name: true } },
          sheets: {
            include: { columns: { orderBy: { ordinal: "asc" } } },
            orderBy: { name: "asc" },
          },
        },
        orderBy: { version: "desc" },
      },
      dashboards: {
        include: { dashboard: { select: { hasSchemaWarning: true } } },
      },
    },
  });
  if (!source) notFound();
  await requireDataSourceAccess(context, id, "preview");
  const canReplace = await hasPermission(context, "excel.replace");
  const current =
    source.excelVersions.find((version) => version.isCurrent) ??
    source.excelVersions[0];
  if (!current)
    return (
      <div className="space-y-6">
        <PageHeader
          title={source.name}
          description="This legacy workbook has no imported version metadata."
        />
      </div>
    );
  const activeSheet =
    current.sheets.find((sheet) => sheet.id === query.sheet) ??
    current.sheets[0];
  const page = Math.max(1, Number(query.page) || 1);
  const search = query.q?.trim().toLowerCase();
  const where = activeSheet
    ? {
        sheetId: activeSheet.id,
        ...(search ? { searchText: { contains: search } } : {}),
      }
    : { sheetId: "" };
  const [rows, total] = activeSheet
    ? await Promise.all([
        db.excelSheetRow.findMany({
          where,
          orderBy: { rowNumber: "asc" },
          skip: (page - 1) * 50,
          take: 50,
        }),
        db.excelSheetRow.count({ where }),
      ])
    : [[], 0];
  return (
    <div className="space-y-6">
      <PageHeader
        title={source.name}
        description={`${current.originalName} · ${(current.sizeBytes / 1024).toFixed(1)} KB · uploaded by ${current.uploadedBy.name}`}
      />
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Version", current.version],
          ["Sheets", current.sheetCount],
          ["Rows", current.rowCount.toLocaleString()],
          ["Status", current.status],
        ].map(([label, value]) => (
          <div key={label} className="rounded-xl border bg-card p-4">
            <p className="text-xs uppercase text-muted-foreground">{label}</p>
            <p className="mt-1 font-semibold">{value}</p>
          </div>
        ))}
      </div>
      {canReplace ? <ReplaceWorkbookForm dataSourceId={id} /> : null}
      {source.dashboards.some((item) => item.dashboard.hasSchemaWarning) ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          The current workbook changed schema. Review affected dashboards before
          publishing or refreshing analysis.
        </div>
      ) : null}
      <section className="rounded-xl border bg-card">
        <div className="flex gap-2 overflow-x-auto border-b p-3">
          {current.sheets.map((sheet) => (
            <a
              key={sheet.id}
              href={`?sheet=${sheet.id}`}
              className={`shrink-0 rounded-lg px-3 py-2 text-sm font-medium ${sheet.id === activeSheet?.id ? "bg-slate-900 text-white" : "bg-slate-100"}`}
            >
              {sheet.name}{" "}
              <span className="opacity-70">({sheet.rowCount})</span>
            </a>
          ))}
        </div>
        {activeSheet ? (
          <>
            <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="font-semibold">{activeSheet.name}</h2>
                <p className="text-xs text-muted-foreground">
                  {activeSheet.columnCount} columns ·{" "}
                  {activeSheet.rowCount.toLocaleString()} rows
                </p>
              </div>
              <form className="flex gap-2">
                <input type="hidden" name="sheet" value={activeSheet.id} />
                <input
                  name="q"
                  defaultValue={query.q}
                  placeholder="Search rows"
                  className="min-h-11 rounded-lg border px-3"
                />
                <button className="min-h-11 rounded-lg bg-slate-900 px-4 text-sm font-medium text-white">
                  Search
                </button>
              </form>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-slate-50">
                  <tr>
                    <th className="px-3 py-3">#</th>
                    {activeSheet.columns.map((column) => (
                      <th key={column.id} className="min-w-36 px-3 py-3">
                        <span>{column.name}</span>
                        <Badge className="ml-2" tone="info">
                          {column.dataType}
                        </Badge>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const data = row.data as Record<string, unknown>;
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="px-3 py-3 text-muted-foreground">
                          {row.rowNumber}
                        </td>
                        {activeSheet.columns.map((column) => (
                          <td
                            key={column.id}
                            className="max-w-72 truncate px-3 py-3"
                          >
                            {data[column.name] === null ||
                            data[column.name] === undefined ? (
                              <span className="italic text-slate-400">
                                empty
                              </span>
                            ) : (
                              String(data[column.name])
                            )}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!rows.length ? (
                <p className="p-8 text-center text-muted-foreground">
                  No rows match this search.
                </p>
              ) : null}
            </div>
            <p className="border-t p-4 text-sm text-muted-foreground">
              Showing {(page - 1) * 50 + (rows.length ? 1 : 0)}–
              {(page - 1) * 50 + rows.length} of {total.toLocaleString()}
            </p>
          </>
        ) : null}
      </section>
      <section>
        <h2 className="mb-3 font-semibold">Version history</h2>
        <div className="space-y-2">
          {source.excelVersions.map((version) => (
            <div
              key={version.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4"
            >
              <div>
                <p className="font-medium">
                  Version {version.version} · {version.originalName}
                </p>
                <p className="text-xs text-muted-foreground">
                  {version.createdAt.toLocaleString()} by{" "}
                  {version.uploadedBy.name}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={version.isCurrent ? "success" : "neutral"}>
                  {version.isCurrent ? "Current" : version.status}
                </Badge>
                <span className="text-sm text-muted-foreground">
                  {version.sheetCount} sheets ·{" "}
                  {version.rowCount.toLocaleString()} rows
                </span>
                {canReplace &&
                !version.isCurrent &&
                version.status === "COMPLETED" ? (
                  <RollbackVersionButton
                    dataSourceId={id}
                    versionId={version.id}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
