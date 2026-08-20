import { notFound } from "next/navigation";
import { Activity, Database, ShieldCheck } from "lucide-react";
import { requireAuthorization } from "@/server/auth/authorization";
import { analysisJobRepository } from "@/server/repositories/analysis-jobs";
import { dashboardRepository } from "@/server/repositories/dashboards";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AnalysisRunner } from "@/components/analysis/analysis-runner";
import { RecommendationReviewTable } from "@/components/analysis/recommendation-review-table";
import { FinalizeDashboardButton } from "@/components/analysis/finalize-dashboard-button";
import {
  businessSchemaAnalysisSchema,
  kpiRecommendationSchema,
} from "@/schemas/analysis";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";

export default async function DashboardAnalysisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  const [dashboard, latestJob] = await Promise.all([
    dashboardRepository.find(context, id),
    analysisJobRepository.latestForDashboard(context, id),
  ]);
  if (!dashboard || !latestJob) notFound();
  await requirePermission(context, "dashboard.update");
  await requireDashboardAccess(context, id, "edit");
  const job = await analysisJobRepository.find(context, latestJob.id);
  if (!job) notFound();
  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Governed AI analysis"
        title={dashboard.name}
        description="Analysis runs as bounded server operations. Progress and every generated artifact are persisted for review."
        action={<Badge tone="info">{job.status.replaceAll("_", " ")}</Badge>}
      />
      <Card className="overflow-hidden">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Analysis progress</CardTitle>
              <CardDescription>
                Current stage: {job.currentStage.replaceAll("_", " ")}
              </CardDescription>
            </div>
            <span className="text-2xl font-semibold tabular-nums text-primary">
              {job.progressPercent}%
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div
            className="h-2 overflow-hidden rounded-full bg-slate-100"
            role="progressbar"
            aria-label="Analysis progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={job.progressPercent}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
              style={{ width: `${job.progressPercent}%` }}
            />
          </div>
          {job.status !== "WAITING_FOR_APPROVAL" ? (
            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <TrustItem
                icon={<Database size={19} />}
                title="Metadata grounded"
                text="Only selected discovered tables and columns enter the analysis context."
              />
              <TrustItem
                icon={<ShieldCheck size={19} />}
                title="Queries guarded"
                text="Generated SQL must pass scope-aware AST validation before execution."
              />
              <TrustItem
                icon={<Activity size={19} />}
                title="Persisted stages"
                text="The current stage can be retried safely without relying on browser state."
              />
            </div>
          ) : null}
          {["QUEUED", "RUNNING", "FAILED"].includes(job.status) ? (
            <AnalysisRunner initialJob={job} />
          ) : null}
        </CardContent>
      </Card>
      {job.status === "WAITING_FOR_APPROVAL" ? (
        <ReviewWorkspace job={job} />
      ) : null}
    </div>
  );
}

function ReviewWorkspace({
  job,
}: {
  job: NonNullable<Awaited<ReturnType<typeof analysisJobRepository.find>>>;
}) {
  const schemaArtifact = job.artifacts.find(
    (artifact) => artifact.type === "SCHEMA_ANALYSIS",
  );
  const schemaAnalysis = businessSchemaAnalysisSchema.safeParse(
    schemaArtifact?.payload,
  );
  const reviewItems = job.recommendations
    .filter((recommendation) => recommendation.status !== "SUPERSEDED")
    .map((recommendation) => {
      const payload =
        recommendation.payload &&
        typeof recommendation.payload === "object" &&
        !Array.isArray(recommendation.payload)
          ? (recommendation.payload as Record<string, unknown>)
          : {};
      const queryDefinitionId =
        typeof payload.queryDefinitionId === "string"
          ? payload.queryDefinitionId
          : null;
      const query = job.queryDefinitions.find((definition) =>
        queryDefinitionId
          ? definition.id === queryDefinitionId
          : definition.recommendationId === recommendation.id,
      );
      const execution = query?.executions[0];
      const kpi = kpiRecommendationSchema.safeParse(
        query?.recommendation?.payload,
      );
      const reviewPayload = kpi.success
        ? {
            ...payload,
            sourceTables: kpi.data.sourceTables,
            sourceColumns: kpi.data.sourceColumns,
            filterAssumptions: kpi.data.filterAssumptions,
            calculationType: kpi.data.calculationType,
          }
        : payload;
      return {
        recommendation: {
          id: recommendation.id,
          type: recommendation.type,
          status: recommendation.status,
          title: recommendation.title,
          description: recommendation.description,
          payload: reviewPayload,
        },
        query: query
          ? {
              id: query.id,
              sql: query.sql,
              previewRows: Array.isArray(execution?.previewRows)
                ? execution.previewRows
                : [],
            }
          : null,
      };
    });
  return (
    <div className="space-y-5">
      {schemaAnalysis.success ? (
        <details className="group rounded-xl border bg-card shadow-sm">
          <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3 marker:content-none">
            <div className="min-w-0">
              <p className="font-semibold">Detected business structure</p>
              <p className="truncate text-xs text-muted-foreground">
                {schemaAnalysis.data.summary}
              </p>
            </div>
            <div className="flex shrink-0 gap-2">
              <Badge tone="neutral">
                {schemaAnalysis.data.entities.length} entities
              </Badge>
              <Badge
                tone={
                  schemaAnalysis.data.dataQualityWarnings.length
                    ? "warning"
                    : "success"
                }
              >
                {schemaAnalysis.data.dataQualityWarnings.length} warnings
              </Badge>
            </div>
          </summary>
          <div className="grid gap-4 border-t p-4 lg:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Business entities
              </h3>
              <div className="mt-2 overflow-hidden rounded-lg border">
                {schemaAnalysis.data.entities.map((entity) => (
                  <div
                    key={entity.name}
                    className="flex items-start justify-between gap-3 border-b px-3 py-2.5 last:border-b-0"
                  >
                    <div>
                      <p className="text-sm font-medium">{entity.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {entity.tables.join(", ")}
                      </p>
                    </div>
                    <Badge tone="neutral">
                      {Math.round(entity.confidence * 100)}%
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Relationships and warnings
              </h3>
              <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                {schemaAnalysis.data.relationshipFindings.map((finding) => (
                  <p key={`${finding.relationshipName}-${finding.fromTable}`}>
                    <span className="font-medium text-foreground">
                      {finding.fromTable} → {finding.toTable}:
                    </span>{" "}
                    {finding.finding}
                  </p>
                ))}
                {schemaAnalysis.data.dataQualityWarnings.map((warning) => (
                  <p key={warning} className="text-amber-800">
                    • {warning}
                  </p>
                ))}
                {!schemaAnalysis.data.relationshipFindings.length &&
                !schemaAnalysis.data.dataQualityWarnings.length ? (
                  <p>No relationship findings or data-quality warnings.</p>
                ) : null}
              </div>
            </div>
          </div>
        </details>
      ) : null}
      <section aria-labelledby="recommendations-heading">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recommendations-heading" className="text-xl font-semibold">
              Review recommendations
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Approve only the KPIs and widgets that match your business intent.
              Rejected items are excluded from the saved dashboard.
            </p>
          </div>
          <FinalizeDashboardButton jobId={job.id} />
        </div>
        <RecommendationReviewTable jobId={job.id} items={reviewItems} />
      </section>
    </div>
  );
}

function TrustItem({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border bg-slate-50/70 p-4">
      <span className="text-primary" aria-hidden="true">
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}
