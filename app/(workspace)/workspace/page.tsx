import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  Bot,
  CircleAlert,
  Database,
  FileText,
  Lightbulb,
  PlugZap,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { dashboardRepository } from "@/server/repositories/dashboards";
import { dataSourceRepository } from "@/server/repositories/data-sources";
import { formatDate } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AddKnowledgeWizard } from "@/components/sources/add-knowledge-wizard";
import { configuredGoogleDriveServiceAccountEmail } from "@/packages/knowledge/google-drive-url";
import { env } from "@/schemas/env";

export const metadata = { title: "Home" };

export default async function WorkspacePage() {
  const context = await requireAuthorization();
  const [
    workspace,
    sources,
    knowledgeSources,
    insights,
    canCreateSource,
    canAddKnowledge,
    databaseConnectionCount,
    apiConnectionCount,
  ] = await Promise.all([
    db.workspace.findUniqueOrThrow({
      where: { id: context.workspaceId },
      include: { organization: true },
    }),
    dataSourceRepository.list(context),
    db.knowledgeSource.findMany({
      where: {
        active: true,
        rack: { organizationId: context.organizationId, active: true },
      },
      select: { status: true },
    }),
    dashboardRepository.list(context),
    hasPermission(context, "datasource.create"),
    hasPermission(context, "knowledge.manage"),
    db.dataSource.count({
      where: {
        workspaceId: context.workspaceId,
        type: { in: ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] },
      },
    }),
    db.legacyApi.count({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
      },
    }),
  ]);
  const [knowledgeFolders, bots] = canAddKnowledge
    ? await Promise.all([
        db.knowledgeRack.findMany({
          where: { organizationId: context.organizationId, active: true },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
        db.bot.findMany({
          where: { organizationId: context.organizationId },
          select: { id: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], []];
  const visibleInsightIds = insights.map((insight) => insight.id);
  const [completedAnalysisCount, runningAnalysisCount] = await Promise.all([
    db.analysisJob.count({
      where: {
        workspaceId: context.workspaceId,
        dashboardId: { in: visibleInsightIds },
        status: "COMPLETED",
      },
    }),
    db.analysisJob.count({
      where: {
        workspaceId: context.workspaceId,
        dashboardId: { in: visibleInsightIds },
        status: { in: ["QUEUED", "RUNNING", "WAITING_FOR_APPROVAL"] },
      },
    }),
  ]);
  const sourceCount = knowledgeSources.length;
  const readySourceCount = knowledgeSources.filter(
    (source) => source.status === "READY",
  ).length;
  const insightCount = insights.length;
  const connectionCount = databaseConnectionCount + apiConnectionCount;
  const recentSources = sources.slice(0, 3);

  return (
    <div className="space-y-7">
      <section className="relative overflow-hidden rounded-[1.5rem] border bg-[linear-gradient(125deg,#ffffff_0%,#f5f3ff_52%,#eef8ff_100%)] px-6 py-7 shadow-[0_18px_50px_rgba(31,31,78,0.06)] sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -right-16 -top-20 size-72 rounded-full bg-indigo-300/15 blur-3xl" />
        <div className="relative flex flex-col gap-7 xl:flex-row xl:items-center xl:justify-between">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
              <Sparkles size={15} /> {workspace.organization.name}
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.035em] text-slate-950 sm:text-4xl">
              Your organization&apos;s knowledge, ready to work.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
              Connect trusted sources, discover business context, and turn
              governed data into insights your team can act on.
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/workspace/analytics/overview">
                <Lightbulb size={17} /> View insights
              </Link>
            </Button>
            {canAddKnowledge ? (
              <AddKnowledgeWizard
                key={knowledgeSources.length}
                folders={knowledgeFolders}
                bots={bots}
                googleDriveServiceAccountEmail={configuredGoogleDriveServiceAccountEmail(
                  env().GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
                )}
              />
            ) : null}
          </div>
        </div>
      </section>

      <section aria-labelledby="knowledge-health-heading">
        <div className="mb-3 flex items-center justify-between">
          <h2 id="knowledge-health-heading" className="text-sm font-semibold">
            Knowledge health
          </h2>
          <span className="text-xs text-muted-foreground">
            Workspace: {workspace.name}
          </span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            icon={<BookOpenText />}
            label="Knowledge sources"
            value={sourceCount}
            detail={`${readySourceCount} ready`}
            tone="indigo"
          />
          <Metric
            icon={<PlugZap />}
            label="Connections"
            value={connectionCount}
            detail={`${databaseConnectionCount} Database · ${apiConnectionCount} API`}
            tone="emerald"
          />
          <Metric
            icon={<Lightbulb />}
            label="Business insights"
            value={insightCount}
            detail={`${completedAnalysisCount} analyses completed`}
            tone="amber"
          />
          <Metric
            icon={<Bot />}
            label="AI activity"
            value={runningAnalysisCount}
            detail={
              runningAnalysisCount === 1
                ? "job in progress"
                : "jobs in progress"
            }
            tone="cyan"
          />
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[1.35fr_.85fr]">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-5 py-4 sm:px-6">
            <div>
              <h2 className="font-semibold">Recently updated knowledge</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Sources available to this workspace
              </p>
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/workspace/data-sources">
                View all <ArrowRight size={15} />
              </Link>
            </Button>
          </div>
          {recentSources.length ? (
            <div className="divide-y">
              {recentSources.map((source) => (
                <Link
                  key={source.id}
                  href={`/workspace/data-sources/${source.id}`}
                  className="group flex min-h-20 items-center gap-4 px-5 py-4 transition-colors hover:bg-slate-50 sm:px-6"
                >
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
                    {source.type === "EXCEL" ? (
                      <FileText size={18} />
                    ) : (
                      <Database size={18} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold group-hover:text-primary">
                      {source.name}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {source.type} · Updated {formatDate(source.updatedAt)}
                    </span>
                  </span>
                  <Badge
                    tone={
                      source.status === "CONNECTED"
                        ? "success"
                        : source.status === "FAILED"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {source.status.replaceAll("_", " ")}
                  </Badge>
                </Link>
              ))}
            </div>
          ) : (
            <CardContent className="grid min-h-64 place-items-center p-8 text-center">
              <div>
                <span className="mx-auto grid size-12 place-items-center rounded-xl bg-secondary text-primary">
                  <Search size={21} />
                </span>
                <h3 className="mt-4 font-semibold">No knowledge sources yet</h3>
                <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                  Add a governed database or file source to begin building your
                  organization&apos;s knowledge foundation.
                </p>
                {canCreateSource ? (
                  <Button asChild className="mt-5" variant="outline">
                    <Link href="/workspace/data-sources/new">
                      Add your first source
                    </Link>
                  </Button>
                ) : null}
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="overflow-hidden">
          <div className="border-b px-5 py-4 sm:px-6">
            <h2 className="font-semibold">InsightKM foundation</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Enterprise controls already active
            </p>
          </div>
          <CardContent className="space-y-1 p-3">
            <FoundationItem
              icon={<ShieldCheck />}
              title="Role-aware access"
              text="Workspace and resource permissions are enforced server-side."
            />
            <FoundationItem
              icon={<Database />}
              title="Read-only data access"
              text="Queries are validated before trusted sources are accessed."
            />
            <FoundationItem
              icon={<CircleAlert />}
              title="Auditable operations"
              text="Security and administrator activity is recorded."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Metric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  detail: string;
  tone: "indigo" | "emerald" | "amber" | "cyan";
}) {
  const toneClasses = {
    indigo: "bg-indigo-50 text-indigo-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
    cyan: "bg-cyan-50 text-cyan-600",
  };
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">
              {value}
            </p>
          </div>
          <span
            className={`grid size-10 place-items-center rounded-xl ${toneClasses[tone]}`}
          >
            {icon}
          </span>
        </div>
        <p className="mt-4 text-xs font-medium text-muted-foreground">
          {detail}
        </p>
      </CardContent>
    </Card>
  );
}

function FoundationItem({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="flex gap-3 rounded-xl p-3 transition-colors hover:bg-slate-50">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 [&>svg]:size-4">
        {icon}
      </span>
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
