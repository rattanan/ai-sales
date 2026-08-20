"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, FlaskConical, RotateCcw, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input, Textarea } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import {
  regenerateRecommendationAction,
  updateRecommendationDecisionAction,
} from "@/features/analysis/actions";
import { editableDashboardWidgetTypes } from "@/schemas/analysis";

type Recommendation = {
  id: string;
  type: "KPI" | "WIDGET";
  status: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";
  title: string;
  description: string | null;
  payload: Record<string, unknown>;
};

type QueryPreview = {
  id: string;
  sql: string;
  previewRows: unknown[];
} | null;

export function RecommendationReviewCard({
  recommendation,
  query,
  onStatusChange,
}: {
  recommendation: Recommendation;
  query: QueryPreview;
  onStatusChange?: (status: Recommendation["status"]) => void;
}) {
  const [status, setStatus] = useState(recommendation.status);
  const router = useRouter();
  const [title, setTitle] = useState(recommendation.title);
  const [description, setDescription] = useState(
    recommendation.description ?? "",
  );
  const [widgetType, setWidgetType] = useState(
    recommendation.type === "WIDGET" &&
      typeof recommendation.payload.type === "string"
      ? recommendation.payload.type
      : "",
  );
  const [gaugeTarget, setGaugeTarget] = useState(() => {
    const thresholds = recommendation.payload.thresholds;
    if (!Array.isArray(thresholds)) return "";
    const first = thresholds[0];
    return first && typeof first === "object" && "value" in first
      ? String(first.value)
      : "";
  });
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState(query?.previewRows ?? []);
  const [pending, startTransition] = useTransition();
  const sourceTables = Array.isArray(recommendation.payload.sourceTables)
    ? recommendation.payload.sourceTables.map(String)
    : [];
  const sourceColumns = Array.isArray(recommendation.payload.sourceColumns)
    ? recommendation.payload.sourceColumns.map(String)
    : [];
  const assumptions = Array.isArray(recommendation.payload.filterAssumptions)
    ? recommendation.payload.filterAssumptions
    : [];
  const calculationType =
    typeof recommendation.payload.calculationType === "string"
      ? recommendation.payload.calculationType.replaceAll("_", " ")
      : null;

  function decide(decision: "APPROVED" | "REJECTED") {
    startTransition(async () => {
      setMessage(null);
      const result = await updateRecommendationDecisionAction({
        recommendationId: recommendation.id,
        decision,
        title,
        description,
        widgetType: recommendation.type === "WIDGET" ? widgetType : undefined,
        gaugeTarget:
          recommendation.type === "WIDGET" &&
          ["GAUGE", "PROGRESS_RING", "BULLET_CHART"].includes(widgetType) &&
          gaugeTarget
            ? gaugeTarget
            : undefined,
      });
      if (!result.ok) return setMessage(result.error.message);
      setStatus(result.data.status);
      onStatusChange?.(result.data.status);
      setTitle(result.data.title);
      setDescription(result.data.description ?? "");
      if (result.data.widgetType) setWidgetType(result.data.widgetType);
      setMessage(
        decision === "APPROVED"
          ? "Recommendation approved."
          : "Recommendation rejected and excluded from finalization.",
      );
    });
  }

  function testQuery() {
    if (!query) return;
    startTransition(async () => {
      setMessage(null);
      const response = await fetch(
        `/api/query-definitions/${query.id}/execute`,
        { method: "POST" },
      );
      const result = await response.json();
      if (!result.ok) return setMessage(result.error.message);
      setPreview(result.data.previewRows);
      setMessage(
        `Query succeeded in ${result.data.durationMs} ms with ${result.data.rowCount} row(s).`,
      );
    });
  }

  function regenerate() {
    startTransition(async () => {
      setMessage(null);
      const result = await regenerateRecommendationAction(recommendation.id);
      if (!result.ok) return setMessage(result.error.message);
      setStatus("SUPERSEDED");
      setMessage(`Generated revision ${result.data.revision}.`);
      router.refresh();
    });
  }

  return (
    <article className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge tone={recommendation.type === "KPI" ? "info" : "neutral"}>
            {recommendation.type}
          </Badge>
          <Badge
            tone={
              status === "APPROVED"
                ? "success"
                : status === "REJECTED"
                  ? "danger"
                  : "warning"
            }
          >
            {status}
          </Badge>
        </div>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Display name" htmlFor={`title-${recommendation.id}`}>
          <Input
            id={`title-${recommendation.id}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        {recommendation.type === "WIDGET" ? (
          <Field
            label="Chart / widget type"
            htmlFor={`widget-type-${recommendation.id}`}
          >
            <select
              id={`widget-type-${recommendation.id}`}
              value={widgetType}
              onChange={(event) => setWidgetType(event.target.value)}
              className="min-h-11 w-full rounded-lg border bg-white px-3 text-sm"
            >
              {editableDashboardWidgetTypes.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {recommendation.type === "WIDGET" &&
        ["GAUGE", "PROGRESS_RING", "BULLET_CHART"].includes(widgetType) ? (
          <Field
            label="Target value"
            htmlFor={`gauge-target-${recommendation.id}`}
          >
            <Input
              id={`gauge-target-${recommendation.id}`}
              type="number"
              min="0.000001"
              step="any"
              value={gaugeTarget}
              onChange={(event) => setGaugeTarget(event.target.value)}
              required
            />
          </Field>
        ) : null}
        <Field
          label="Description"
          htmlFor={`description-${recommendation.id}`}
          className="sm:col-span-2"
        >
          <Textarea
            id={`description-${recommendation.id}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      {sourceTables.length || sourceColumns.length ? (
        <dl className="mt-4 grid gap-3 rounded-lg bg-slate-50 p-4 text-xs sm:grid-cols-2">
          <div>
            <dt className="font-semibold text-slate-700">Source tables</dt>
            <dd className="mt-1 break-words text-slate-600">
              {sourceTables.join(", ") || "None"}
            </dd>
          </div>
          <div>
            <dt className="font-semibold text-slate-700">Source columns</dt>
            <dd className="mt-1 break-words text-slate-600">
              {sourceColumns.join(", ") || "None"}
            </dd>
          </div>
          {assumptions.length ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-slate-700">Assumptions</dt>
              <dd className="mt-1 text-slate-600">
                {assumptions
                  .map((assumption) =>
                    assumption &&
                    typeof assumption === "object" &&
                    "description" in assumption
                      ? String(assumption.description)
                      : "",
                  )
                  .filter(Boolean)
                  .join(" · ")}
              </dd>
            </div>
          ) : null}
          {calculationType ? (
            <div className="sm:col-span-2">
              <dt className="font-semibold text-slate-700">Calculation</dt>
              <dd className="mt-1 text-slate-600">
                {calculationType} using the validated source columns above.
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      {query ? (
        <details className="mt-4 rounded-lg border bg-slate-950 text-slate-100">
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium">
            Validated SQL and real preview
          </summary>
          <div className="border-t border-slate-800 p-4">
            <pre className="overflow-x-auto whitespace-pre-wrap text-xs leading-5">
              {query.sql}
            </pre>
            {preview.length ? (
              <pre className="mt-4 max-h-52 overflow-auto rounded bg-slate-900 p-3 text-xs">
                {JSON.stringify(preview, null, 2)}
              </pre>
            ) : (
              <p className="mt-3 text-xs text-slate-400">No preview rows.</p>
            )}
          </div>
        </details>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-2">
        <Button disabled={pending} onClick={() => decide("APPROVED")}>
          <Check size={17} /> Save & approve
        </Button>
        <Button
          disabled={pending}
          variant="outline"
          onClick={() => decide("REJECTED")}
        >
          {recommendation.type === "WIDGET" ? (
            <Trash2 size={17} />
          ) : (
            <X size={17} />
          )}
          {recommendation.type === "WIDGET" ? "Remove" : "Reject"}
        </Button>
        {query ? (
          <Button disabled={pending} variant="secondary" onClick={testQuery}>
            <FlaskConical size={17} /> Test SQL
          </Button>
        ) : null}
        <Button disabled={pending} variant="ghost" onClick={regenerate}>
          <RotateCcw size={17} /> Regenerate
        </Button>
      </div>
      {message ? (
        <p className="mt-3 text-sm text-muted-foreground" aria-live="polite">
          {message}
        </p>
      ) : null}
    </article>
  );
}
