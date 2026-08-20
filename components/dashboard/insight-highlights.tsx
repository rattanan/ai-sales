"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  History,
  Lightbulb,
  LoaderCircle,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  acknowledgeInsightAction,
  analyzeFilteredInsightsAction,
} from "@/features/insights/actions";

export type Insight = {
  title: string;
  statement: string;
  confidence: number;
  caveats: string[];
};

export type InsightHistoryItem = {
  type: "GENERATED" | "ACKNOWLEDGED";
  insight: Insight;
  createdAt: string;
};

function insightStyle(insight: Insight) {
  const text = `${insight.title} ${insight.statement}`.toLowerCase();
  if (/risk|warning|declin|drop|late|critical|overdue/.test(text))
    return {
      label: "Watch",
      icon: AlertTriangle,
      tone: "warning" as const,
      className: "from-amber-50 to-orange-50 border-amber-200 text-amber-800",
    };
  if (/opportun|growth|improv|increase|positive/.test(text))
    return {
      label: "Opportunity",
      icon: ArrowUpRight,
      tone: "success" as const,
      className:
        "from-emerald-50 to-teal-50 border-emerald-200 text-emerald-800",
    };
  if (/recommend|next step|action/.test(text))
    return {
      label: "Recommendation",
      icon: Lightbulb,
      tone: "info" as const,
      className: "from-cyan-50 to-blue-50 border-cyan-200 text-cyan-900",
    };
  return {
    label: "Key finding",
    icon: Sparkles,
    tone: "info" as const,
    className: "from-blue-50 to-indigo-50 border-blue-200 text-blue-950",
  };
}

export function InsightHighlights({
  dashboardId,
  insights,
  acknowledgedInsights = [],
  initialHistory = [],
  hasFilteredAnalysis = false,
}: {
  dashboardId: string;
  insights: Insight[];
  acknowledgedInsights?: Insight[];
  initialHistory?: InsightHistoryItem[];
  hasFilteredAnalysis?: boolean;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeInsights, setActiveInsights] = useState(() =>
    insights.filter(
      (insight) =>
        !acknowledgedInsights.some(
          (item) =>
            item.title === insight.title &&
            item.statement === insight.statement,
        ),
    ),
  );
  const [history, setHistory] = useState(initialHistory);
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [stale, setStale] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [analyzedFilters, setAnalyzedFilters] = useState(hasFilteredAnalysis);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const changed = (event: Event) => {
      setFilters((event as CustomEvent<Record<string, string[]>>).detail ?? {});
      setStale(true);
    };
    window.addEventListener("dashboard:filters-changed", changed);
    return () =>
      window.removeEventListener("dashboard:filters-changed", changed);
  }, []);

  function analyze() {
    setError(null);
    startTransition(async () => {
      const result = await analyzeFilteredInsightsAction({
        dashboardId,
        filters,
      });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setActiveInsights(result.data.insights);
      setHistory((items) => [
        ...result.data.insights.map((insight) => ({
          type: "GENERATED" as const,
          insight,
          createdAt: result.data.generatedAt,
        })),
        ...items,
      ]);
      setAnalyzedFilters(true);
      setStale(false);
    });
  }

  function acknowledge(insight: Insight) {
    setError(null);
    startTransition(async () => {
      const result = await acknowledgeInsightAction({ dashboardId, insight });
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setActiveInsights((items) => items.filter((item) => item !== insight));
      setHistory((items) => [
        {
          type: "ACKNOWLEDGED",
          insight,
          createdAt: result.data.acknowledgedAt,
        },
        ...items,
      ]);
    });
  }
  return (
    <section
      aria-labelledby="ai-highlights-heading"
      className="dashboard-section-enter mt-7"
    >
      <div className="mb-3 flex flex-col items-start justify-between gap-3 px-1 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-700">
            AI business insight
          </p>
          <h2
            id="ai-highlights-heading"
            className="mt-1 text-lg font-semibold tracking-tight"
          >
            What needs attention
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setShowHistory(true)}
          >
            <History size={15} /> History{" "}
            {history.length ? `(${history.length})` : ""}
          </Button>
          {stale ? (
            <Button
              type="button"
              size="sm"
              onClick={analyze}
              disabled={pending}
            >
              {pending ? (
                <LoaderCircle className="animate-spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
              Analyze filtered data
            </Button>
          ) : (
            <Badge tone="info">Grounded findings</Badge>
          )}
        </div>
      </div>
      {stale ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>
            Filters changed. Current insights may no longer match the visible
            data.
          </span>
          <Badge tone="warning">Refresh recommended</Badge>
        </div>
      ) : null}
      {error ? (
        <p className="mb-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {activeInsights.map((insight) => {
          const style = insightStyle(insight);
          const Icon = style.icon;
          const isExpanded = expanded === insight.title;
          return (
            <article
              key={`${insight.title}-${insight.statement}`}
              className={`rounded-2xl border bg-gradient-to-br p-5 shadow-sm transition-transform duration-200 hover:-translate-y-0.5 motion-reduce:transition-none ${style.className}`}
            >
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-10 place-items-center rounded-xl bg-white/75 shadow-sm">
                  <Icon size={19} />
                </span>
                <Badge tone={style.tone}>{style.label}</Badge>
              </div>
              <h3 className="mt-4 truncate text-sm font-semibold">
                {insight.title}
              </h3>
              <p
                className={`mt-1.5 text-sm leading-6 opacity-85 ${isExpanded ? "" : "line-clamp-3"}`}
              >
                {insight.statement}
              </p>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-current/10 pt-3">
                <span className="text-xs font-medium">
                  Confidence {Math.round(insight.confidence * 100)}%
                </span>
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setExpanded(isExpanded ? null : insight.title)
                    }
                  >
                    {isExpanded ? "Less" : "Explore"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => acknowledge(insight)}
                  >
                    <Check size={14} /> Acknowledge
                  </Button>
                </div>
              </div>
              {isExpanded && insight.caveats.length ? (
                <p className="mt-3 text-xs leading-5 opacity-75">
                  Notes: {insight.caveats.slice(0, 3).join(" · ")}
                </p>
              ) : null}
            </article>
          );
        })}
      </div>
      {!activeInsights.length ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          {analyzedFilters
            ? "No new grounded insights were found for the current filters. Open History to review earlier findings."
            : "All current insights have been acknowledged. Open History to review them."}
        </div>
      ) : null}
      {showHistory ? (
        <div
          className="fixed inset-0 z-[70] bg-slate-950/40"
          role="presentation"
          onClick={() => setShowHistory(false)}
        >
          <aside
            className="ml-auto flex h-full w-[min(34rem,100vw)] flex-col bg-card text-foreground shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="insight-history-title"
            onClick={(event) => event.stopPropagation()}
          >
            <header className="flex min-h-16 items-center justify-between border-b px-5">
              <div>
                <h3 id="insight-history-title" className="font-semibold">
                  Insight history
                </h3>
                <p className="text-xs text-muted-foreground">
                  Generated and acknowledged findings
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                aria-label="Close insight history"
                onClick={() => setShowHistory(false)}
              >
                <X size={17} />
              </Button>
            </header>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {history.length ? (
                history.map((item, index) => (
                  <article
                    key={`${item.type}-${item.createdAt}-${index}`}
                    className="rounded-xl border p-4"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        tone={item.type === "ACKNOWLEDGED" ? "success" : "info"}
                      >
                        {item.type === "ACKNOWLEDGED"
                          ? "Acknowledged"
                          : "Generated"}
                      </Badge>
                      <time className="text-xs text-muted-foreground">
                        {new Intl.DateTimeFormat(undefined, {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(item.createdAt))}
                      </time>
                    </div>
                    <h4 className="mt-3 text-sm font-semibold">
                      {item.insight.title}
                    </h4>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {item.insight.statement}
                    </p>
                  </article>
                ))
              ) : (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  No insight history yet.
                </p>
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </section>
  );
}
