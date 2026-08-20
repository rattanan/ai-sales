import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { DatabaseQueryWorkbench } from "@/components/data-sources/database-query-workbench";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { dataSourceRepository } from "@/server/repositories/data-sources";

const databaseTypes = new Set(["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"]);

export default async function DatabaseQueryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  const source = await dataSourceRepository.find(context, id);
  if (
    !source ||
    source.status !== "CONNECTED" ||
    !databaseTypes.has(source.type)
  )
    notFound();
  const selected = source.schemas.reduce(
    (count, schema) =>
      count + schema.tables.filter((table) => table.selected).length,
    0,
  );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <Button asChild variant="ghost">
        <Link href={`/workspace/data-sources/${source.id}`}>
          <ArrowLeft size={16} /> Back to data source
        </Link>
      </Button>
      <PageHeader
        eyebrow="Phase 5 · Database intelligence"
        title={`Ask ${source.name}`}
        description="Generate, review, and execute a single grounded read-only query over the metadata you are authorized to access."
        action={<Badge>{source.type}</Badge>}
      />
      <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-950">
        <ShieldCheck className="mt-0.5 shrink-0" size={18} />
        <p>
          Governed scope: {selected} selected tables. Every query is revalidated
          immediately before execution with a hard row limit and timeout.
        </p>
      </div>
      <DatabaseQueryWorkbench
        dataSourceId={source.id}
        sourceName={source.name}
      />
    </div>
  );
}
