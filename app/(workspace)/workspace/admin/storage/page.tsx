import { HardDrive, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { env } from "@/schemas/env";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";

export const metadata = { title: "Storage administration" };

function formatBytes(value: number) {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  if (value < 1_073_741_824) return `${(value / 1_048_576).toFixed(1)} MB`;
  return `${(value / 1_073_741_824).toFixed(1)} GB`;
}

export default async function StorageAdministrationPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "system.health.view");
  const configuration = env();
  const [documents, documentStorage, databaseFiles] = await Promise.all([
    db.document.count({
      where: { organizationId: context.organizationId, active: true },
    }),
    db.documentVersion.aggregate({
      where: { document: { organizationId: context.organizationId } },
      _sum: { size: true },
      _count: true,
    }),
    db.dataSourceFile.aggregate({
      where: { dataSource: { workspaceId: context.workspaceId } },
      _sum: { sizeBytes: true },
      _count: true,
    }),
  ]);
  const storedBytes =
    (documentStorage._sum.size ?? 0) + (databaseFiles._sum.sizeBytes ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Storage"
        description="Read-only storage configuration and tenant-scoped usage for uploaded knowledge and database files."
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Active documents", documents.toLocaleString()],
          ["Document versions", documentStorage._count.toLocaleString()],
          ["Database files", databaseFiles._count.toLocaleString()],
          ["Stored file data", formatBytes(storedBytes)],
        ].map(([label, value]) => (
          <Card key={label}>
            <CardHeader className="pb-2">
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-2xl">{value}</CardTitle>
            </CardHeader>
          </Card>
        ))}
      </section>
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive size={19} aria-hidden="true" /> Object storage
              </CardTitle>
              <CardDescription className="mt-1">
                Runtime configuration is managed through the deployment
                environment.
              </CardDescription>
            </div>
            <Badge tone="info">
              {configuration.OBJECT_STORAGE_DRIVER.toUpperCase()}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid gap-4 rounded-xl border bg-muted/30 p-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Driver
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {configuration.OBJECT_STORAGE_DRIVER}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Upload limit
              </dt>
              <dd className="mt-1 text-sm font-semibold">
                {formatBytes(configuration.KNOWLEDGE_MAX_UPLOAD_BYTES)} per file
              </dd>
            </div>
            {configuration.OBJECT_STORAGE_DRIVER === "local" ? (
              <div className="sm:col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Local storage path
                </dt>
                <dd className="mt-1 break-all font-mono text-sm">
                  {configuration.LOCAL_STORAGE_PATH}
                </dd>
              </div>
            ) : null}
          </dl>
          <p className="flex gap-2 text-sm leading-6 text-muted-foreground">
            <ShieldCheck
              className="mt-0.5 shrink-0 text-emerald-700"
              size={18}
              aria-hidden="true"
            />
            Secrets and provider credentials are not exposed on this page.
            Change storage settings through the controlled deployment process,
            then verify availability from System Health.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
