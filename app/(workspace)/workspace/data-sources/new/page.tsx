import { requireAuthorization } from "@/server/auth/authorization";
import { dataSourceRepository } from "@/server/repositories/data-sources";
import { SetupWizard } from "@/components/wizard/setup-wizard";
import { PageHeader } from "@/components/ui/page-header";
import {
  hasPermission,
  requireDataSourceAccess,
  requirePermission,
} from "@/server/auth/permissions";

export const metadata = { title: "Data source setup" };
export default async function NewDataSourcePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const context = await requireAuthorization();
  const id = typeof query.id === "string" ? query.id : undefined;
  if (id) {
    await requirePermission(context, "datasource.update");
    if (!(await hasPermission(context, "role.manage"))) {
      await requireDataSourceAccess(context, id, "manage");
    }
  } else {
    await requirePermission(context, "datasource.create");
  }
  const source = id ? await dataSourceRepository.find(context, id) : null;
  const serializedSource = source
    ? {
        id: source.id,
        name: source.name,
        type: source.type,
        status: source.status,
        host: source.host,
        port: source.port,
        databaseName: source.databaseName,
        username: source.username,
        sslEnabled: source.sslEnabled,
        connectionOptions:
          source.connectionOptions &&
          typeof source.connectionOptions === "object" &&
          !Array.isArray(source.connectionOptions)
            ? source.connectionOptions
            : {},
        fileName: source.file?.originalName,
        sheetNames: Array.isArray(source.file?.sheetNames)
          ? source.file.sheetNames.map(String)
          : [],
        schemas: source.schemas.map((schema) => ({
          id: schema.id,
          name: schema.name,
          tables: schema.tables.map((table) => ({
            id: table.id,
            name: table.name,
            tableType: table.tableType,
            selected: table.selected,
            estimatedRows: table.estimatedRowCount?.toString() ?? null,
          })),
        })),
      }
    : undefined;
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Guided setup"
        title={id ? "Finish data source setup" : "Create a data source"}
        description="Connect data, verify access, discover metadata, and choose the governed tables and views available to AI features."
      />
      <SetupWizard
        initialStep={Number(query.step) || 1}
        initialType={
          typeof query.type === "string" ? (query.type as never) : undefined
        }
        source={serializedSource}
      />
    </div>
  );
}
