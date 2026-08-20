import Link from "next/link";
import { LayoutDashboard, Plus } from "lucide-react";
import { requireAuthorization } from "@/server/auth/authorization";
import { dashboardRepository } from "@/server/repositories/dashboards";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/server/auth/permissions";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { canStartDashboardAnalysis } from "@/server/services/dashboard-analysis-state";

export const metadata = { title: "Business insights" };
export default async function DashboardsPage() {
  const context = await requireAuthorization();
  const [dashboards, canCreateDashboard, canUpdate, canDelete, manageAll] =
    await Promise.all([
      dashboardRepository.list(context),
      hasPermission(context, "dashboard.create"),
      hasPermission(context, "dashboard.update"),
      hasPermission(context, "dashboard.delete"),
      hasPermission(context, "role.manage"),
    ]);
  return (
    <div className="space-y-7">
      <PageHeader
        title="Business insights"
        description="Review grounded analysis, business context, and decision-ready insight workspaces."
        action={
          canCreateDashboard ? (
            <Button asChild>
              <Link href="/workspace/dashboards/new">
                <Plus size={17} />
                Create insight workspace
              </Link>
            </Button>
          ) : undefined
        }
      />
      {dashboards.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {dashboards.map((dashboard) => {
            const resourceAccess = dashboard.access[0]?.level;
            const canEditResource =
              manageAll ||
              dashboard.createdById === context.userId ||
              resourceAccess === "OWNER" ||
              resourceAccess === "EDITOR";
            const primaryDataSource = dashboard.dataSources[0]?.dataSource;
            const canBuildFromSource =
              manageAll ||
              Boolean(
                primaryDataSource?.access.some(
                  (access) => access.canBuild || access.canManage,
                ),
              );
            const analysisAvailable = canStartDashboardAnalysis(
              dashboard.status,
              dashboard,
              dashboard.analysisJobs[0]?.requestSnapshot,
            );
            return (
              <Card
                key={dashboard.id}
                className="h-full hover:border-slate-400"
              >
                <CardContent className="p-5">
                  <div className="flex items-start gap-4">
                    <span className="grid size-11 place-items-center rounded-lg bg-secondary text-primary">
                      <LayoutDashboard size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap justify-between gap-2">
                        <h2 className="font-semibold">
                          <Link
                            href={`/workspace/dashboards/${dashboard.id}`}
                            className="rounded-sm hover:text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                          >
                            {dashboard.name}
                          </Link>
                        </h2>
                        <Badge
                          tone={
                            dashboard.status === "ANALYZING"
                              ? "warning"
                              : dashboard.status === "PUBLISHED"
                                ? "success"
                                : "neutral"
                          }
                        >
                          {dashboard.status}
                        </Badge>
                      </div>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {dashboard.businessObjective ||
                          "Objective not completed"}
                      </p>
                      <p className="mt-4 text-xs text-muted-foreground">
                        {dashboard._count.versions} versions · Updated{" "}
                        {formatDate(dashboard.updatedAt)}
                      </p>
                      {canEditResource && (canUpdate || canDelete) ? (
                        <div className="mt-5 border-t pt-4">
                          <DashboardActions
                            dashboard={{
                              id: dashboard.id,
                              name: dashboard.name,
                              status: dashboard.status,
                              dataSourceId: primaryDataSource?.id,
                            }}
                            canEdit={canUpdate && canBuildFromSource}
                            canAnalyze={
                              canUpdate &&
                              (dashboard.status === "ANALYZING" ||
                                analysisAvailable)
                            }
                            canDelete={canDelete}
                            compact
                          />
                        </div>
                      ) : null}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="grid place-items-center p-12 text-center">
            <LayoutDashboard className="mb-4 text-slate-400" size={34} />
            <h2 className="font-semibold">No business insights yet</h2>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              An insight workspace is created during the knowledge-source setup.
            </p>
            {canCreateDashboard ? (
              <Button asChild className="mt-5">
                <Link href="/workspace/dashboards/new">
                  <Plus size={17} />
                  Create insight workspace
                </Link>
              </Button>
            ) : null}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
