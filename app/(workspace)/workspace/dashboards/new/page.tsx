import Link from "next/link";
import { ArrowRight, Database, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export const metadata = { title: "Create dashboard" };

export default async function NewDashboardPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.create");
  const [manageAll, canCreateDataSource] = await Promise.all([
    hasPermission(context, "role.manage"),
    hasPermission(context, "datasource.create"),
  ]);
  const sources = await db.dataSource.findMany({
    where: {
      workspaceId: context.workspaceId,
      ...(manageAll
        ? {}
        : {
            access: {
              some: {
                userId: context.userId,
                OR: [{ canBuild: true }, { canManage: true }],
              },
            },
          }),
    },
    select: {
      id: true,
      name: true,
      type: true,
      status: true,
      host: true,
      file: { select: { originalName: true } },
      _count: { select: { schemas: true, dashboards: true } },
    },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="New dashboard"
        title="Choose a data source"
        description="Select a governed data source you can build from. The next step captures business context, layout, and visual direction."
        action={
          canCreateDataSource ? (
            <Button asChild variant="outline">
              <Link href="/workspace/data-sources/new">
                <Plus size={17} /> New data source
              </Link>
            </Button>
          ) : undefined
        }
      />
      {sources.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {sources.map((source) => (
            <Card key={source.id} className="h-full hover:border-slate-400">
              <CardContent className="flex h-full flex-col p-5">
                <div className="flex items-start gap-4">
                  <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-secondary text-primary">
                    <Database size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="truncate font-semibold">{source.name}</h2>
                      <Badge
                        tone={
                          source.status === "CONNECTED" ? "success" : "neutral"
                        }
                      >
                        {source.status.replaceAll("_", " ")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {source.type} ·{" "}
                      {source.host ??
                        source.file?.originalName ??
                        "Configured source"}
                    </p>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {source._count.schemas} schemas ·{" "}
                      {source._count.dashboards} dashboards
                    </p>
                  </div>
                </div>
                <Button asChild className="mt-5 w-full" variant="outline">
                  <Link
                    href={`/workspace/data-sources/new?step=6&id=${encodeURIComponent(source.id)}`}
                  >
                    Use this data source <ArrowRight size={17} />
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="grid place-items-center p-12 text-center">
            <Database className="mb-4 text-slate-400" size={34} />
            <h2 className="font-semibold">No buildable data source</h2>
            <p className="mt-2 max-w-lg text-sm text-muted-foreground">
              Ask an administrator for Build access to a data source
              {canCreateDataSource
                ? ", or create and configure a new source."
                : "."}
            </p>
            {canCreateDataSource ? (
              <Button asChild className="mt-5">
                <Link href="/workspace/data-sources/new">
                  <Plus size={17} /> Create data source
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
