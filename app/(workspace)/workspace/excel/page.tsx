import Link from "next/link";
import { FileSpreadsheet } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function ExcelSourcesPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "excel.upload");
  const sources = await db.dataSource.findMany({
    where: { workspaceId: context.workspaceId, type: "EXCEL" },
    include: {
      excelVersions: { where: { isCurrent: true }, take: 1 },
      createdBy: { select: { name: true } },
    },
    orderBy: { updatedAt: "desc" },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Excel uploads"
        description="Versioned workbooks imported as governed logical tables."
        action={
          <Link href="/workspace/data-sources/new?step=source">
            <Button>Upload workbook</Button>
          </Link>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {sources.map((source) => {
          const version = source.excelVersions[0];
          return (
            <Link
              key={source.id}
              href={`/workspace/excel/${source.id}`}
              className="rounded-xl border bg-card p-5 transition hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex gap-4">
                <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <FileSpreadsheet size={20} />
                </span>
                <div>
                  <h2 className="font-semibold">{source.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {version?.originalName ?? "Legacy workbook"}
                  </p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Version {version?.version ?? 1} · {version?.sheetCount ?? 0}{" "}
                    sheets · {(version?.rowCount ?? 0).toLocaleString()} rows ·
                    uploaded by {source.createdBy.name}
                  </p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
      {!sources.length ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          No Excel workbooks have been imported.
        </div>
      ) : null}
    </div>
  );
}
