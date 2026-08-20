"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCheck,
  ChevronDown,
  ChevronRight,
  ListChecks,
  LoaderCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { approveRecommendationsAction } from "@/features/analysis/actions";
import { RecommendationReviewCard } from "./recommendation-review-card";

type ReviewStatus = "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED";

export type ReviewTableItem = {
  recommendation: {
    id: string;
    type: "KPI" | "WIDGET";
    status: ReviewStatus;
    title: string;
    description: string | null;
    payload: Record<string, unknown>;
  };
  query: {
    id: string;
    sql: string;
    previewRows: unknown[];
  } | null;
};

function statusTone(status: ReviewStatus) {
  if (status === "APPROVED") return "success" as const;
  if (status === "REJECTED") return "danger" as const;
  return "warning" as const;
}

export function RecommendationReviewTable({
  jobId,
  items,
}: {
  jobId: string;
  items: ReviewTableItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set<string>());
  const [expanded, setExpanded] = useState(() => new Set<string>());
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>(() =>
    Object.fromEntries(
      items.map((item) => [item.recommendation.id, item.recommendation.status]),
    ),
  );
  const [message, setMessage] = useState<string | null>(null);
  const selectableIds = useMemo(
    () =>
      items
        .filter((item) => statuses[item.recommendation.id] !== "APPROVED")
        .map((item) => item.recommendation.id),
    [items, statuses],
  );
  const allChecked =
    selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleSelection(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allChecked ? new Set() : new Set(selectableIds));
  }

  function toggleExpanded(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function approve(ids?: string[]) {
    startTransition(async () => {
      setMessage(null);
      const result = await approveRecommendationsAction({
        analysisJobId: jobId,
        recommendationIds: ids,
      });
      if (!result.ok) return setMessage(result.error.message);
      setStatuses((current) => ({
        ...current,
        ...Object.fromEntries(
          result.data.recommendationIds.map((id) => [id, "APPROVED"]),
        ),
      }));
      setSelected(new Set());
      setMessage(`${result.data.approvedCount} recommendation(s) approved.`);
      router.refresh();
    });
  }

  return (
    <div className="mt-4 overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex flex-col gap-3 border-b bg-slate-50/80 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !selectableIds.length}
            onClick={toggleAll}
          >
            <ListChecks size={16} /> {allChecked ? "Clear checks" : "Check all"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={pending || !selected.size}
            onClick={() => approve([...selected])}
          >
            <CheckCheck size={16} /> Approve checked ({selected.size})
          </Button>
        </div>
        <Button
          type="button"
          size="sm"
          disabled={pending || !selectableIds.length}
          onClick={() => approve()}
        >
          {pending ? (
            <LoaderCircle
              className="animate-spin motion-reduce:animate-none"
              size={16}
            />
          ) : (
            <CheckCheck size={16} />
          )}
          Approve all
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left text-sm">
          <caption className="sr-only">
            AI-generated KPI and widget recommendations for approval
          </caption>
          <thead className="border-b bg-muted/40 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-12 px-3 py-2.5">
                <input
                  type="checkbox"
                  className="size-4 rounded border-slate-300 accent-primary"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="Check all recommendations"
                  disabled={!selectableIds.length}
                />
              </th>
              <th className="w-20 px-3 py-2.5">Type</th>
              <th className="px-3 py-2.5">Recommendation</th>
              <th className="w-36 px-3 py-2.5">Source</th>
              <th className="w-28 px-3 py-2.5">Status</th>
              <th className="w-28 px-3 py-2.5 text-right">Details</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {items.map(({ recommendation, query }) => {
              const status = statuses[recommendation.id];
              const isApproved = status === "APPROVED";
              const isExpanded = expanded.has(recommendation.id);
              const sourceTables = Array.isArray(
                recommendation.payload.sourceTables,
              )
                ? recommendation.payload.sourceTables.map(String)
                : [];
              return (
                <Fragment key={recommendation.id}>
                  <tr
                    className={
                      isExpanded ? "bg-blue-50/40" : "hover:bg-muted/30"
                    }
                  >
                    <td className="px-3 py-3 align-top">
                      <input
                        type="checkbox"
                        className="size-4 rounded border-slate-300 accent-primary"
                        checked={selected.has(recommendation.id)}
                        disabled={pending || isApproved}
                        onChange={() => toggleSelection(recommendation.id)}
                        aria-label={`Check ${recommendation.title}`}
                      />
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge
                        tone={
                          recommendation.type === "KPI" ? "info" : "neutral"
                        }
                      >
                        {recommendation.type}
                      </Badge>
                    </td>
                    <td className="max-w-md px-3 py-3 align-top">
                      <p className="font-medium text-foreground">
                        {recommendation.title}
                      </p>
                      {recommendation.description ? (
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {recommendation.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="max-w-36 px-3 py-3 align-top text-xs text-muted-foreground">
                      <span className="line-clamp-2">
                        {sourceTables.join(", ") ||
                          (query ? "Validated query" : "Layout")}
                      </span>
                    </td>
                    <td className="px-3 py-3 align-top">
                      <Badge tone={statusTone(status)}>{status}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right align-top">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleExpanded(recommendation.id)}
                        aria-expanded={isExpanded}
                        aria-controls={`review-${recommendation.id}`}
                      >
                        {isExpanded ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                        {isExpanded ? "Close" : "Review"}
                      </Button>
                    </td>
                  </tr>
                  {isExpanded ? (
                    <tr id={`review-${recommendation.id}`}>
                      <td colSpan={6} className="bg-slate-50/60 p-3">
                        <RecommendationReviewCard
                          recommendation={{ ...recommendation, status }}
                          query={query}
                          onStatusChange={(nextStatus) => {
                            setStatuses((current) => ({
                              ...current,
                              [recommendation.id]: nextStatus,
                            }));
                            setSelected((current) => {
                              const next = new Set(current);
                              next.delete(recommendation.id);
                              return next;
                            });
                          }}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex min-h-10 items-center justify-between gap-3 border-t px-3 py-2 text-xs text-muted-foreground">
        <span>{items.length} recommendations</span>
        <span aria-live="polite">{message}</span>
      </div>
    </div>
  );
}
