import { notFound } from "next/navigation";
import Link from "next/link";
import {
  Bot,
  BriefcaseBusiness,
  ChevronDown,
  Clock3,
  Database,
  LayoutTemplate,
} from "lucide-react";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  hasPermission,
  requireDashboardAccess,
} from "@/server/auth/permissions";
import { dashboardRepository } from "@/server/repositories/dashboards";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Button } from "@/components/ui/button";
import { DashboardRenderer } from "@/components/dashboard/dashboard-renderer";
import {
  dashboardWidgetDefinitionSchema,
  generatedInsightsSchema,
  kpiRecommendationSchema,
} from "@/schemas/analysis";
import { db } from "@/server/db";
import { hasRole } from "@/server/auth/roles";
import { DashboardActions } from "@/components/dashboard/dashboard-actions";
import { canStartDashboardAnalysis } from "@/server/services/dashboard-analysis-state";
import { DashboardCopilot } from "@/components/copilot/dashboard-copilot";
import {
  InsightHighlights,
  type Insight,
  type InsightHistoryItem,
} from "@/components/dashboard/insight-highlights";
import { insightDisplaySchema } from "@/schemas/dashboard-insights";

export default async function DashboardDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  const dashboard = await dashboardRepository.find(context, id);
  if (!dashboard) notFound();
  await requireDashboardAccess(context, id, "view");
  const [canUpdate, canDelete, manageAll, copilotPolicy] = await Promise.all([
    hasPermission(context, "dashboard.update"),
    hasPermission(context, "dashboard.delete"),
    hasPermission(context, "role.manage"),
    db.aIAccessPolicy.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      select: { copilotEnabled: true },
    }),
  ]);
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
  const [latestJob, latestCompletedJob, insightAuditLogs] = await Promise.all([
    db.analysisJob.findFirst({
      where: {
        dashboardId: dashboard.id,
        workspaceId: context.workspaceId,
      },
      orderBy: { createdAt: "desc" },
    }),
    db.analysisJob.findFirst({
      where: {
        dashboardId: dashboard.id,
        workspaceId: context.workspaceId,
        status: "COMPLETED",
      },
      include: {
        queryDefinitions: {
          include: {
            recommendation: { select: { payload: true } },
            executions: {
              where: { status: "SUCCEEDED" },
              orderBy: { createdAt: "desc" },
              take: 1,
            },
          },
        },
        artifacts: { where: { type: "GENERATED_INSIGHTS" } },
      },
      orderBy: { completedAt: "desc" },
    }),
    db.auditLog.findMany({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        entityId: dashboard.id,
        action: {
          in: [
            "DASHBOARD_FILTERED_INSIGHTS_GENERATED",
            "DASHBOARD_INSIGHT_ACKNOWLEDGED",
          ],
        },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { action: true, metadata: true, createdAt: true },
    }),
  ]);
  const queries = new Map(
    latestCompletedJob?.queryDefinitions.map((query) => [query.id, query]) ??
      [],
  );
  const insights = generatedInsightsSchema(50).safeParse(
    latestCompletedJob?.artifacts[0]?.payload,
  );
  const parseInsights = (value: unknown): Insight[] => {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      const parsed = insightDisplaySchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    });
  };
  const insightHistory = insightAuditLogs.flatMap<InsightHistoryItem>((log) => {
    const metadata =
      log.metadata &&
      typeof log.metadata === "object" &&
      !Array.isArray(log.metadata)
        ? log.metadata
        : null;
    if (!metadata) return [];
    if (log.action === "DASHBOARD_INSIGHT_ACKNOWLEDGED") {
      const parsed = insightDisplaySchema.safeParse(
        "insight" in metadata ? metadata.insight : null,
      );
      return parsed.success
        ? [
            {
              type: "ACKNOWLEDGED",
              insight: parsed.data,
              createdAt: log.createdAt.toISOString(),
            },
          ]
        : [];
    }
    const values =
      "insights" in metadata && Array.isArray(metadata.insights)
        ? metadata.insights
        : [];
    return values.flatMap<InsightHistoryItem>((value) => {
      const parsed = insightDisplaySchema.safeParse(value);
      return parsed.success
        ? [
            {
              type: "GENERATED",
              insight: parsed.data,
              createdAt: log.createdAt.toISOString(),
            },
          ]
        : [];
    });
  });
  const latestGenerationIndex = insightAuditLogs.findIndex(
    (log) => log.action === "DASHBOARD_FILTERED_INSIGHTS_GENERATED",
  );
  const latestGeneration =
    latestGenerationIndex >= 0 ? insightAuditLogs[latestGenerationIndex] : null;
  const latestGenerationMetadata =
    latestGeneration?.metadata &&
    typeof latestGeneration.metadata === "object" &&
    !Array.isArray(latestGeneration.metadata)
      ? latestGeneration.metadata
      : null;
  const filteredInsights = parseInsights(
    latestGenerationMetadata && "insights" in latestGenerationMetadata
      ? latestGenerationMetadata.insights
      : null,
  );
  const displayedInsights = latestGeneration
    ? filteredInsights
    : insights.success
      ? insights.data.insights
      : [];
  const acknowledgementWindow =
    latestGenerationIndex >= 0
      ? insightAuditLogs.slice(0, latestGenerationIndex)
      : insightAuditLogs;
  const acknowledgedCurrentInsights = acknowledgementWindow.flatMap((log) => {
    if (log.action !== "DASHBOARD_INSIGHT_ACKNOWLEDGED") return [];
    const metadata =
      log.metadata &&
      typeof log.metadata === "object" &&
      !Array.isArray(log.metadata)
        ? log.metadata
        : null;
    const parsed = insightDisplaySchema.safeParse(
      metadata && "insight" in metadata ? metadata.insight : null,
    );
    return parsed.success ? [parsed.data] : [];
  });
  const renderedWidgets = dashboard.widgets.flatMap((widget) => {
    const config =
      widget.config &&
      typeof widget.config === "object" &&
      !Array.isArray(widget.config)
        ? widget.config
        : null;
    const definition = dashboardWidgetDefinitionSchema.safeParse(
      config && "definition" in config ? config.definition : null,
    );
    if (!definition.success) return [];
    const query = definition.data.queryDefinitionId
      ? queries.get(definition.data.queryDefinitionId)
      : null;
    const kpi = kpiRecommendationSchema.safeParse(
      query?.recommendation?.payload,
    );
    const insight = insights.success
      ? (insights.data.insights.find((item) =>
          item.supportingWidgetIds.includes(definition.data.id),
        ) ??
        (["AI_INSIGHT", "TEXT_INSIGHT"].includes(definition.data.type)
          ? insights.data.insights[0]
          : null))
      : null;
    const preview = query?.executions[0]?.previewRows;
    const sampleRows =
      config && "sampleRows" in config && Array.isArray(config.sampleRows)
        ? config.sampleRows
        : [];
    const resultRows = Array.isArray(preview) ? preview : sampleRows;
    return [
      {
        recordId: widget.id,
        definition: definition.data,
        rows: Array.isArray(resultRows)
          ? resultRows
              .filter(
                (row) =>
                  Boolean(row) &&
                  typeof row === "object" &&
                  !Array.isArray(row),
              )
              .map((row) => ({ ...(row as Record<string, unknown>) }))
          : [],
        insight: insight
          ? {
              title: insight.title,
              statement: insight.statement,
              caveats: insight.caveats,
            }
          : null,
        provenance: kpi.success
          ? {
              sourceTables: kpi.data.sourceTables,
              sourceColumns: kpi.data.sourceColumns,
              calculationType: kpi.data.calculationType,
              assumptions: kpi.data.filterAssumptions.map(
                (assumption) => assumption.description,
              ),
            }
          : null,
      },
    ];
  });
  return (
    <div
      className={`bi-dashboard space-y-7 ${dashboard.visualStyle === "DARK_CONTROL_ROOM" ? "dashboard-dark" : ""}`}
    >
      <div className="dashboard-hero p-4 sm:p-5">
        <PageHeader
          eyebrow="Dashboard configuration"
          title={dashboard.name}
          description={dashboard.businessObjective || "Objective not completed"}
          action={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={dashboard.status === "ANALYZING" ? "warning" : "neutral"}
              >
                {dashboard.status}
              </Badge>
              {canEditResource ? (
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
                    (dashboard.status === "ANALYZING" || analysisAvailable)
                  }
                  canDelete={canDelete}
                />
              ) : null}
            </div>
          }
        />
        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgb(16_185_129/0.12)]" />
            Data ready
          </span>
          <span>Updated {formatDate(dashboard.updatedAt)}</span>
          <span className="truncate">
            {primaryDataSource?.name || "No data source"}
          </span>
          <span className="hidden sm:inline">
            Use filters or Ask Copilot to refine the view
          </span>
        </div>
      </div>
      {dashboard.status === "ANALYZING" ? (
        <Card className="border-blue-200 bg-blue-50/40">
          <CardContent className="flex flex-col items-start gap-5 p-7 sm:flex-row sm:items-center">
            <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-primary text-white">
              <Bot />
            </span>
            <div>
              <h2 className="font-semibold">
                AI analysis is prepared for a later phase
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                The analysis job persists each completed stage and requires
                human approval before any generated widget is saved.
              </p>
              {latestJob ? (
                <Button asChild className="mt-4">
                  <Link href={`/workspace/dashboards/${dashboard.id}/analysis`}>
                    Open analysis progress
                  </Link>
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-3">
        <SummaryCard
          icon={<Database />}
          title="Data source"
          value={
            dashboard.dataSources
              .map((item) => item.dataSource.name)
              .join(", ") || "None"
          }
        />
        <SummaryCard
          icon={<LayoutTemplate />}
          title="Layout and style"
          value={`${dashboard.layoutStyle.replaceAll("_", " ")} · ${dashboard.visualTheme}`}
        />
        <SummaryCard
          icon={<Clock3 />}
          title="Latest version"
          value={
            dashboard.versions[0]
              ? `Version ${dashboard.versions[0].version} · ${formatDate(dashboard.versions[0].createdAt)}`
              : "No version saved"
          }
        />
      </div>
      <details className="group overflow-hidden rounded-xl border bg-card shadow-sm">
        <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 px-4 py-3 transition-colors duration-200 marker:content-none hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
          <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-blue-50 text-primary">
            <BriefcaseBusiness size={19} aria-hidden="true" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              Business context
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              {dashboard.businessArea || "Business area not specified"} ·{" "}
              {dashboard.targetUsers || "Target users not specified"}
            </span>
          </span>
          <Badge tone="neutral" className="hidden shrink-0 sm:inline-flex">
            6 fields
          </Badge>
          <ChevronDown
            className="shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
            size={18}
            aria-hidden="true"
          />
        </summary>
        <dl className="grid gap-px border-t bg-border sm:grid-cols-2 lg:grid-cols-3">
          <Context label="Business area" value={dashboard.businessArea} />
          <Context label="Target users" value={dashboard.targetUsers} />
          <Context label="Desired KPIs" value={dashboard.desiredKpis} />
          <Context label="Reporting period" value={dashboard.reportingPeriod} />
          <Context
            label="Business questions"
            value={dashboard.businessQuestions}
          />
          <Context
            label="Important filters"
            value={dashboard.importantFilters}
          />
        </dl>
      </details>
      {dashboard.status === "GENERATED" ||
      (dashboard.status === "ANALYZING" && dashboard.widgets.length) ? (
        <section aria-labelledby="generated-dashboard-heading">
          <div className="mb-5 px-1">
            <h2
              id="generated-dashboard-heading"
              className="text-xl font-semibold"
            >
              {dashboard.status === "ANALYZING"
                ? "Current dashboard"
                : "Generated dashboard"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {dashboard.status === "ANALYZING"
                ? "The approved dashboard remains available while the updated objective is analyzed."
                : "Every value below comes from a successfully executed validated query."}
            </p>
          </div>
          <DashboardRenderer
            widgets={renderedWidgets}
            canReorder={hasRole(context.role, "DASHBOARD_DESIGNER")}
          />
          {latestGeneration ||
          displayedInsights.length ||
          insightHistory.length ? (
            <InsightHighlights
              dashboardId={dashboard.id}
              insights={displayedInsights}
              acknowledgedInsights={acknowledgedCurrentInsights}
              initialHistory={insightHistory}
              hasFilteredAnalysis={Boolean(latestGeneration)}
            />
          ) : null}
        </section>
      ) : null}
      {manageAll || copilotPolicy?.copilotEnabled ? (
        <DashboardCopilot
          dashboardId={dashboard.id}
          dashboardName={dashboard.name}
          widgets={dashboard.widgets.map((widget) => ({
            id: widget.id,
            title: widget.title,
          }))}
          canEdit={canEditResource && canUpdate}
        />
      ) : null}
    </div>
  );
}
function SummaryCard({
  icon,
  title,
  value,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
}) {
  return (
    <Card>
      <CardContent className="flex gap-3 p-5">
        <span className="text-primary">{icon}</span>
        <div>
          <p className="text-xs font-medium text-muted-foreground">{title}</p>
          <p className="mt-1 text-sm font-semibold capitalize">
            {value.toLowerCase()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
function Context({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0 bg-card p-4">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-slate-700">
        {value || "Not specified"}
      </dd>
    </div>
  );
}
