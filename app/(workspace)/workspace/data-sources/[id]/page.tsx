import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Columns3,
  Database,
  KeyRound,
  MessageSquareText,
  Sparkles,
  Table2,
} from "lucide-react";
import { requireAuthorization } from "@/server/auth/authorization";
import { dataSourceRepository } from "@/server/repositories/data-sources";
import { formatDate } from "@/lib/utils";
import { DataSourceStatusBadge } from "@/components/data-sources/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ServerOperationButton } from "@/components/wizard/server-operation-button";
import { DeleteDataSourceDialog } from "@/components/data-sources/delete-data-source-dialog";
import { hasPermission } from "@/server/auth/permissions";
import { Button } from "@/components/ui/button";
import { DatabaseScopeForm } from "@/components/data-sources/database-scope-form";

const databaseTypes = new Set(["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"]);

function metadataDiff(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export default async function DataSourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  const source = await dataSourceRepository.find(context, id);
  if (!source) notFound();
  const canManage = await hasPermission(context, "datasource.update");
  const canDelete = await hasPermission(context, "datasource.delete");
  const tableCount = source.schemas.reduce(
    (sum, schema) => sum + schema.tables.length,
    0,
  );
  const columnCount = source.schemas.reduce(
    (sum, schema) =>
      sum + schema.tables.reduce((n, table) => n + table.columns.length, 0),
    0,
  );
  const isDatabase = databaseTypes.has(source.type);
  const discoveredSchemas = source.schemas.filter(
    (schema) => schema.tables.length > 0,
  );
  const diff = metadataDiff(source.lastMetadataDiff);
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={source.type}
        title={source.name}
        description="Credentials remain encrypted and are never returned by this page."
        action={<DataSourceStatusBadge status={source.status} />}
      />
      <Card className="border-indigo-200 bg-indigo-50 text-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base text-indigo-900">
            <Sparkles
              className="text-indigo-700"
              size={17}
              aria-hidden="true"
            />{" "}
            AI preview
          </CardTitle>
          <CardDescription className="text-slate-600">
            Generated during the latest successful import or metadata discovery.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-slate-900">
            {source.previewSummary ??
              "Preview will appear after the source is imported or metadata discovery completes."}
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          {canManage ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>Connection</CardTitle>
                    <CardDescription>
                      Sanitized server-side configuration.
                    </CardDescription>
                  </div>
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={`/workspace/data-sources/new?step=3&type=${source.type}&id=${source.id}`}
                    >
                      Edit connection
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Info label="Host" value={source.host || "—"} />
                <Info label="Port" value={source.port?.toString() || "—"} />
                <Info label="Database" value={source.databaseName || "—"} />
                <Info label="Username" value={source.username || "—"} />
                <Info
                  label="TLS"
                  value={source.sslEnabled ? "Enabled" : "Disabled"}
                />
                <Info
                  label="Credential"
                  value={
                    source.credential ? "Encrypted and stored" : "Not stored"
                  }
                />
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle>Discovered metadata</CardTitle>
              <CardDescription>
                {source.lastDiscoveredAt
                  ? `Last discovered ${formatDate(source.lastDiscoveredAt)}`
                  : "Metadata has not been discovered."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {discoveredSchemas.length ? (
                <div className="space-y-3">
                  {discoveredSchemas.map((schema) => (
                    <details key={schema.id} className="rounded-lg border">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 font-medium">
                        <span>{schema.name}</span>
                        <Badge>{schema.tables.length} objects</Badge>
                      </summary>
                      <div className="border-t p-3">
                        {schema.tables.map((table) => (
                          <div
                            key={table.id}
                            className="flex items-center justify-between rounded-md px-2 py-2 text-sm hover:bg-muted"
                          >
                            <span className="flex min-w-0 items-start gap-2">
                              <Table2
                                size={16}
                                className="mt-0.5 shrink-0 text-muted-foreground"
                              />
                              <span className="min-w-0">
                                <span className="block break-all">
                                  {table.name}
                                </span>
                                {table.semanticDescription ||
                                table.databaseComment ? (
                                  <span className="mt-0.5 block text-xs text-muted-foreground">
                                    {table.semanticDescription ||
                                      table.databaseComment}
                                  </span>
                                ) : null}
                              </span>
                            </span>
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {table.columns.length} columns ·{" "}
                              {table.selected ? "selected" : "not selected"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Run metadata discovery after a successful MySQL connection
                  test.
                </p>
              )}
            </CardContent>
          </Card>
          {canManage && isDatabase && discoveredSchemas.length ? (
            <Card>
              <CardHeader>
                <CardTitle>Governed database scope</CardTitle>
                <CardDescription>
                  Only selected tables can be queried by Chat and other AI
                  features. Discovered tables remain unavailable until you
                  explicitly add them here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DatabaseScopeForm
                  dataSourceId={source.id}
                  sampleDataEnabled={source.sampleDataEnabled}
                  schemas={discoveredSchemas.map((schema) => ({
                    id: schema.id,
                    name: schema.name,
                    tables: schema.tables.map((table) => ({
                      id: table.id,
                      name: table.name,
                      tableType: table.tableType,
                      selected: table.selected,
                      sampleDataEnabled: table.sampleDataEnabled,
                      semanticDescription: table.semanticDescription,
                      columnCount: table.columns.length,
                    })),
                  }))}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
        <aside className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Connection actions</CardTitle>
              <CardDescription>Executed only on the server.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {isDatabase && source.status === "CONNECTED" ? (
                <Button asChild className="w-full">
                  <Link href={`/workspace/data-sources/${id}/query`}>
                    <MessageSquareText size={16} /> Ask this database
                  </Link>
                </Button>
              ) : null}
              <ServerOperationButton endpoint={`/api/data-sources/${id}/test`}>
                Test connection
              </ServerOperationButton>
              <ServerOperationButton
                endpoint={`/api/data-sources/${id}/discover`}
              >
                Discover metadata
              </ServerOperationButton>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-4 p-5">
              <Summary
                icon={<Database />}
                label="Schemas"
                value={discoveredSchemas.length}
              />
              <Summary
                icon={<Table2 />}
                label="Tables and views"
                value={tableCount}
              />
              <Summary
                icon={<Columns3 />}
                label="Columns"
                value={columnCount}
              />
              <Summary
                icon={<KeyRound />}
                label="Credential exposed"
                value="No"
              />
              {isDatabase ? (
                <>
                  <Summary
                    label="Metadata version"
                    value={source.metadataVersion}
                    icon={<Database />}
                  />
                  {diff ? (
                    <Summary
                      label="Latest metadata diff"
                      value={`${String(diff.addedTables ?? 0)}+ / ${String(diff.changedTables ?? 0)}~ / ${String(diff.removedTables ?? 0)}−`}
                      icon={<Table2 />}
                    />
                  ) : null}
                </>
              ) : null}
            </CardContent>
          </Card>
          {canDelete ? (
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-destructive">Danger zone</CardTitle>
                <CardDescription>
                  Permanently remove this connection and all discovered
                  metadata.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DeleteDataSourceDialog
                  dataSourceId={source.id}
                  dataSourceName={source.name}
                  linkedDashboards={source.dashboards.length}
                />
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-all text-sm font-medium">{value}</dd>
    </div>
  );
}
function Summary({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="flex-1 text-sm text-muted-foreground">{label}</span>
      <strong className="text-sm tabular-nums">{value}</strong>
    </div>
  );
}
