"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Funnel,
  FunnelChart,
  LabelList,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  RadialBar,
  RadialBarChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  CircleHelp,
  CircleAlert,
  Download,
  Filter,
  RotateCcw,
  Search,
  Sparkles,
  Target,
} from "lucide-react";
import type { DashboardWidgetDefinition } from "@/schemas/analysis";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { reorderDashboardWidgetAction } from "@/features/analysis/actions";

const PALETTES = {
  BLUE: [
    "#2563eb",
    "#0ea5e9",
    "#14b8a6",
    "#8b5cf6",
    "#f59e0b",
    "#f43f5e",
    "#64748b",
    "#06b6d4",
  ],
  EMERALD: [
    "#059669",
    "#14b8a6",
    "#0ea5e9",
    "#84cc16",
    "#f59e0b",
    "#8b5cf6",
    "#64748b",
    "#22c55e",
  ],
  AMBER: [
    "#f59e0b",
    "#f97316",
    "#ef4444",
    "#8b5cf6",
    "#0ea5e9",
    "#14b8a6",
    "#64748b",
    "#eab308",
  ],
  SLATE: [
    "#334155",
    "#2563eb",
    "#0ea5e9",
    "#14b8a6",
    "#8b5cf6",
    "#f59e0b",
    "#f43f5e",
    "#64748b",
  ],
} as const;

type FilterState = Record<string, string[]>;
type WidgetFilter = NonNullable<DashboardWidgetDefinition["filters"]>[number];

export type RenderedWidget = {
  recordId: string;
  definition: DashboardWidgetDefinition;
  rows: Record<string, unknown>[];
  loading?: boolean;
  error?: string | null;
  insight?: {
    title: string;
    statement: string;
    caveats: string[];
  } | null;
  provenance?: {
    sourceTables: string[];
    sourceColumns: string[];
    calculationType: string;
    assumptions: string[];
  } | null;
};

export type DatePreset =
  | "TODAY"
  | "YESTERDAY"
  | "THIS_WEEK"
  | "LAST_WEEK"
  | "THIS_MONTH"
  | "LAST_MONTH"
  | "THIS_YEAR"
  | "LAST_YEAR";

const DATE_PRESETS: Array<{ value: DatePreset; label: string }> = [
  { value: "TODAY", label: "Today" },
  { value: "YESTERDAY", label: "Yesterday" },
  { value: "THIS_WEEK", label: "This week" },
  { value: "LAST_WEEK", label: "Last week" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "LAST_YEAR", label: "Last year" },
];

function localIsoDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function datePresetRange(preset: DatePreset, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start);
  if (preset === "YESTERDAY") {
    start.setDate(start.getDate() - 1);
    end.setDate(end.getDate() - 1);
  } else if (preset === "THIS_WEEK" || preset === "LAST_WEEK") {
    const mondayOffset = (start.getDay() + 6) % 7;
    start.setDate(
      start.getDate() - mondayOffset - (preset === "LAST_WEEK" ? 7 : 0),
    );
    end.setTime(start.getTime());
    end.setDate(start.getDate() + 6);
  } else if (preset === "THIS_MONTH" || preset === "LAST_MONTH") {
    const monthOffset = preset === "LAST_MONTH" ? -1 : 0;
    start.setFullYear(now.getFullYear(), now.getMonth() + monthOffset, 1);
    end.setFullYear(now.getFullYear(), now.getMonth() + monthOffset + 1, 0);
  } else if (preset === "THIS_YEAR" || preset === "LAST_YEAR") {
    const year = now.getFullYear() - (preset === "LAST_YEAR" ? 1 : 0);
    start.setFullYear(year, 0, 1);
    end.setFullYear(year, 11, 31);
  }
  return { from: localIsoDate(start), to: localIsoDate(end) };
}

export function aggregateCategoricalRows(
  rows: Record<string, unknown>[],
  categoryField: string,
  measures: string[],
) {
  const grouped = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const category =
      String(row[categoryField] ?? "Unknown").trim() || "Unknown";
    const current = grouped.get(category) ?? {
      ...row,
      [categoryField]: category,
      ...Object.fromEntries(measures.map((measure) => [measure, 0])),
    };
    for (const measure of measures)
      current[measure] = numeric(current[measure]) + numeric(row[measure]);
    grouped.set(category, current);
  }
  return [...grouped.values()].sort(
    (left, right) => numeric(right[measures[0]]) - numeric(left[measures[0]]),
  );
}

const REORDER_SHORTFALL_FIELD = "reorder_shortfall";

export function prepareReorderRiskRows(
  rows: Record<string, unknown>[],
  categoryField: string,
  stockField: string,
  reorderField: string,
) {
  return rows.flatMap((row) => {
    const category = String(row[categoryField] ?? "").trim();
    const shortfall = Math.max(
      numeric(row[reorderField]) - numeric(row[stockField]),
      0,
    );
    if (!category || /^[\p{P}\p{S}\s]+$/u.test(category) || shortfall === 0)
      return [];
    return [
      {
        ...row,
        [categoryField]: category,
        [REORDER_SHORTFALL_FIELD]: shortfall,
      },
    ];
  });
}

function compactAxisLabel(value: unknown, maxLength = 24) {
  const label = formatChartDateTime(value);
  const characters = Array.from(label);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join("")}…`
    : label;
}

/** Keep source timestamps stable in charts while hiding seconds/milliseconds. */
export function formatChartDateTime(value: unknown) {
  const text = String(value ?? "");
  const match = text.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/,
  );
  return match?.[1] ?? text;
}

function numeric(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: unknown) {
  const timestamp = new Date(String(value ?? "")).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatValue(value: unknown, widget: DashboardWidgetDefinition) {
  if (value == null) return "—";
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  const options: Intl.NumberFormatOptions = {
    maximumFractionDigits: widget.formatting.decimals,
    notation: widget.formatting.compact ? "compact" : "standard",
  };
  if (widget.formatting.displayFormat === "CURRENCY") {
    options.style = "currency";
    options.currency = widget.formatting.currency ?? "USD";
  }
  if (widget.formatting.displayFormat === "PERCENTAGE") {
    options.style = "percent";
    return `${widget.formatting.prefix ?? ""}${new Intl.NumberFormat(
      undefined,
      options,
    ).format(number / 100)}${widget.formatting.suffix ?? ""}`;
  }
  return `${widget.formatting.prefix ?? ""}${new Intl.NumberFormat(
    undefined,
    options,
  ).format(
    number,
  )}${widget.formatting.unit ? ` ${widget.formatting.unit}` : ""}${widget.formatting.suffix ?? ""}`;
}

function uniqueFilters(widgets: RenderedWidget[]) {
  const filters = new Map<string, Omit<WidgetFilter, "field">>();
  for (const widget of widgets)
    for (const filter of widget.definition.filters ?? [])
      filters.set(filter.id, {
        id: filter.id,
        label: filter.label,
        control: filter.control,
      });
  return [...filters.values()];
}

function filterOptions(widgets: RenderedWidget[], filterId: string) {
  const values = new Set<string>();
  for (const widget of widgets) {
    const binding = widget.definition.filters?.find(
      (filter) => filter.id === filterId,
    );
    if (!binding) continue;
    for (const row of widget.rows) {
      const value = row[binding.field];
      if (value != null && String(value).trim()) values.add(String(value));
    }
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

export function applyDashboardFilters(
  rows: Record<string, unknown>[],
  bindings: WidgetFilter[] | undefined,
  state: FilterState,
) {
  if (!bindings?.length) return rows;
  return rows.filter((row) =>
    bindings.every((binding) => {
      if (binding.control === "DATE_RANGE") {
        const value = dateValue(row[binding.field]);
        const from = state[`${binding.id}:from`]?.[0];
        const to = state[`${binding.id}:to`]?.[0];
        if (value == null) return !from && !to;
        return (
          (!from || value >= new Date(`${from}T00:00:00`).getTime()) &&
          (!to || value <= new Date(`${to}T23:59:59.999`).getTime())
        );
      }
      const selected = state[binding.id] ?? [];
      return !selected.length || selected.includes(String(row[binding.field]));
    }),
  );
}

export function DashboardRenderer({
  widgets,
  canReorder,
}: {
  widgets: RenderedWidget[];
  canReorder: boolean;
}) {
  const [filters, setFilters] = useState<FilterState>({});
  const filtersInitialized = useRef(false);
  const definitions = useMemo(() => uniqueFilters(widgets), [widgets]);
  useEffect(() => {
    if (!filtersInitialized.current) {
      filtersInitialized.current = true;
      return;
    }
    window.dispatchEvent(
      new CustomEvent("dashboard:filters-changed", { detail: filters }),
    );
  }, [filters]);
  useEffect(() => {
    const applyCopilotFilters = (event: Event) => {
      const suggestions = (
        event as CustomEvent<Array<{ value: string; datePreset?: string }>>
      ).detail;
      if (!suggestions?.length) return;
      setFilters((current) => {
        const next = { ...current };
        for (const suggestion of suggestions) {
          if (suggestion.datePreset) {
            const dateFilter = definitions.find(
              (filter) => filter.control === "DATE_RANGE",
            );
            if (!dateFilter) continue;
            const range = datePresetRange(suggestion.datePreset as DatePreset);
            next[`${dateFilter.id}:preset`] = [suggestion.datePreset];
            next[`${dateFilter.id}:from`] = [range.from];
            next[`${dateFilter.id}:to`] = [range.to];
            continue;
          }
          const target = definitions.find(
            (filter) =>
              filter.control !== "DATE_RANGE" &&
              filterOptions(widgets, filter.id).some(
                (option) =>
                  option.toLowerCase() === suggestion.value.toLowerCase(),
              ),
          );
          if (target) next[target.id] = [suggestion.value];
        }
        return next;
      });
    };
    window.addEventListener("dashboard:copilot-filters", applyCopilotFilters);
    return () =>
      window.removeEventListener(
        "dashboard:copilot-filters",
        applyCopilotFilters,
      );
  }, [definitions, widgets]);
  if (!widgets.length)
    return (
      <WidgetState
        title="No approved widgets"
        message="Review and approve widget recommendations before finalizing."
      />
    );
  return (
    <div className="space-y-5">
      {definitions.length ? (
        <GlobalFilterBar
          definitions={definitions}
          widgets={widgets}
          state={filters}
          onChange={setFilters}
        />
      ) : null}
      <div className="dashboard-grid dashboard-section-enter">
        {widgets.map((widget, index) => (
          <div
            key={widget.recordId}
            className="dashboard-widget"
            style={
              {
                "--widget-width": widget.definition.layout.width,
                "--widget-tablet-width":
                  widget.definition.layout.width <= 4 ? 6 : 12,
                "--widget-height": widget.definition.layout.height,
              } as React.CSSProperties
            }
          >
            <WidgetCard
              widget={{
                ...widget,
                rows: applyDashboardFilters(
                  widget.rows,
                  widget.definition.filters,
                  filters,
                ),
              }}
              canMoveBack={canReorder && index > 0}
              canMoveForward={canReorder && index < widgets.length - 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

function GlobalFilterBar({
  definitions,
  widgets,
  state,
  onChange,
}: {
  definitions: Omit<WidgetFilter, "field">[];
  widgets: RenderedWidget[];
  state: FilterState;
  onChange: (state: FilterState) => void;
}) {
  return (
    <section
      aria-label="Dashboard filters"
      className="rounded-xl border bg-card p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter size={17} className="text-primary" aria-hidden="true" />
          <h2 className="text-sm font-semibold">Filters</h2>
          <Badge tone="neutral">{definitions.length}</Badge>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!Object.values(state).some((value) => value.length)}
          onClick={() => onChange({})}
        >
          <RotateCcw size={15} /> Reset
        </Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {definitions.map((filter) => {
          if (filter.control === "DATE_RANGE")
            return (
              <fieldset
                key={filter.id}
                className="grid grid-cols-2 gap-2 sm:col-span-2"
              >
                <legend className="col-span-2 text-xs font-semibold text-muted-foreground">
                  {filter.label}
                </legend>
                <select
                  aria-label={`${filter.label} preset`}
                  className="col-span-2 min-h-11 rounded-lg border bg-white px-3 text-sm"
                  value={state[`${filter.id}:preset`]?.[0] ?? ""}
                  onChange={(event) => {
                    const preset = event.target.value as DatePreset | "";
                    if (!preset)
                      return onChange({
                        ...state,
                        [`${filter.id}:preset`]: [],
                      });
                    const range = datePresetRange(preset);
                    onChange({
                      ...state,
                      [`${filter.id}:preset`]: [preset],
                      [`${filter.id}:from`]: [range.from],
                      [`${filter.id}:to`]: [range.to],
                    });
                  }}
                >
                  <option value="">Custom range</option>
                  {DATE_PRESETS.map((preset) => (
                    <option key={preset.value} value={preset.value}>
                      {preset.label}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  aria-label={`${filter.label} from`}
                  className="min-h-11 min-w-0 rounded-lg border bg-white px-2 text-sm"
                  value={state[`${filter.id}:from`]?.[0] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      [`${filter.id}:from`]: event.target.value
                        ? [event.target.value]
                        : [],
                      [`${filter.id}:preset`]: [],
                    })
                  }
                />
                <input
                  type="date"
                  aria-label={`${filter.label} to`}
                  className="min-h-11 min-w-0 rounded-lg border bg-white px-2 text-sm"
                  value={state[`${filter.id}:to`]?.[0] ?? ""}
                  onChange={(event) =>
                    onChange({
                      ...state,
                      [`${filter.id}:to`]: event.target.value
                        ? [event.target.value]
                        : [],
                      [`${filter.id}:preset`]: [],
                    })
                  }
                />
              </fieldset>
            );
          const options = filterOptions(widgets, filter.id);
          return (
            <label
              key={filter.id}
              className="text-xs font-semibold text-muted-foreground"
            >
              {filter.label}
              <select
                className="mt-1 min-h-11 w-full rounded-lg border bg-white px-3 text-sm font-normal text-foreground"
                value={state[filter.id]?.[0] ?? ""}
                onChange={(event) =>
                  onChange({
                    ...state,
                    [filter.id]: event.target.value ? [event.target.value] : [],
                  })
                }
              >
                <option value="">All</option>
                {options.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </section>
  );
}

function WidgetCard({
  widget,
  canMoveBack,
  canMoveForward,
}: {
  widget: RenderedWidget;
  canMoveBack: boolean;
  canMoveForward: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const canExport = widget.definition.interaction?.export !== false;
  const visualKind = ["KPI", "STAT"].includes(widget.definition.type)
    ? "kpi"
    : ["AI_INSIGHT", "TEXT_INSIGHT"].includes(widget.definition.type)
      ? "insight"
      : widget.definition.type === "TABLE"
        ? "table"
        : "chart";
  return (
    <Card
      className={`dashboard-card dashboard-card-${visualKind} flex h-full min-h-[calc(var(--widget-height)*2rem)] flex-col overflow-visible`}
    >
      <CardHeader className="flex-row items-start justify-between gap-3 pb-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base leading-5">
              {widget.definition.title}
            </CardTitle>
            {widget.definition.priority === "PRIMARY" ? (
              <Badge tone="info">Key metric</Badge>
            ) : null}
          </div>
          {widget.definition.description ? (
            <CardDescription className="mt-1 line-clamp-2">
              {widget.definition.description}
            </CardDescription>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-1">
          <WidgetHelp widget={widget} />
          {canExport && widget.rows.length ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={`Export ${widget.definition.title} as CSV`}
              onClick={() => downloadCsv(widget)}
            >
              <Download size={16} />
            </Button>
          ) : null}
          {canMoveBack || canMoveForward ? (
            <>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canMoveBack || pending}
                aria-label={`Move ${widget.definition.title} earlier`}
                onClick={() =>
                  startTransition(async () => {
                    await reorderDashboardWidgetAction(widget.recordId, "UP");
                  })
                }
              >
                <ArrowLeft size={16} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={!canMoveForward || pending}
                aria-label={`Move ${widget.definition.title} later`}
                onClick={() =>
                  startTransition(async () => {
                    await reorderDashboardWidgetAction(widget.recordId, "DOWN");
                  })
                }
              >
                <ArrowRight size={16} />
              </Button>
            </>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <DashboardWidgetRenderer widget={widget} />
      </CardContent>
    </Card>
  );
}

function friendlyField(reference: string) {
  return reference.split(".").at(-1)?.replaceAll("_", " ") ?? reference;
}

function calculationExplanation(widget: RenderedWidget) {
  const provenance = widget.provenance;
  if (!provenance)
    return "Uses the validated query result mapped to this widget.";
  const fields = provenance.sourceColumns.map(friendlyField);
  const measure =
    fields[0] ?? widget.definition.dataMapping.measures[0] ?? "records";
  if (provenance.calculationType === "COUNT") return "Counts matching records.";
  if (provenance.calculationType === "DISTINCT_COUNT")
    return `Counts distinct ${measure}.`;
  if (provenance.calculationType === "SUM") return `Adds together ${measure}.`;
  if (provenance.calculationType === "AVERAGE")
    return `Calculates the average of ${measure}.`;
  if (provenance.calculationType === "RATIO")
    return `Calculates a ratio using ${fields.join(" and ") || "the mapped measures"}.`;
  return "Uses the validated query result mapped to this widget.";
}

function WidgetHelp({ widget }: { widget: RenderedWidget }) {
  return (
    <details className="group/help relative z-30">
      <summary
        className="grid size-11 cursor-pointer list-none place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary marker:content-none [&::-webkit-details-marker]:hidden"
        aria-label={`Explain ${widget.definition.title}`}
        title="Data source and calculation"
      >
        <CircleHelp size={17} />
      </summary>
      <div className="absolute right-0 top-12 z-40 w-[min(22rem,calc(100vw-3rem))] rounded-xl border bg-card p-4 text-left shadow-xl">
        <p className="text-sm font-semibold">How this widget is calculated</p>
        <dl className="mt-3 space-y-3 text-xs leading-5">
          <div>
            <dt className="font-semibold text-muted-foreground">Purpose</dt>
            <dd>{widget.definition.businessQuestion}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">Formula</dt>
            <dd>{calculationExplanation(widget)}</dd>
          </div>
          <div>
            <dt className="font-semibold text-muted-foreground">Data source</dt>
            <dd>
              {widget.provenance?.sourceTables.map(friendlyField).join(", ") ||
                "Validated analysis query"}
            </dd>
          </div>
          {widget.provenance?.assumptions.length ? (
            <div>
              <dt className="font-semibold text-muted-foreground">
                Filters and assumptions
              </dt>
              <dd>{widget.provenance.assumptions.join(" · ")}</dd>
            </div>
          ) : null}
        </dl>
      </div>
    </details>
  );
}

export function DashboardWidgetRenderer({
  widget,
}: {
  widget: RenderedWidget;
}) {
  const { definition, rows } = widget;
  if (widget.loading)
    return (
      <WidgetState
        title="Loading visualization"
        message="Fetching validated data…"
        loading
      />
    );
  if (widget.error)
    return (
      <WidgetState title="Query unavailable" message={widget.error} error />
    );
  if (!rows.length && ["AI_INSIGHT", "TEXT_INSIGHT"].includes(definition.type))
    return (
      <InsightWidget
        definition={definition}
        rows={rows}
        insight={widget.insight}
      />
    );
  if (!rows.length)
    return (
      <WidgetState
        title="No matching data"
        message={definition.emptyStateMessage}
      />
    );

  switch (definition.type) {
    case "KPI":
    case "STAT":
      return <KpiWidget definition={definition} rows={rows} />;
    case "LINE_CHART":
      return (
        <CartesianWidget definition={definition} rows={rows} kind="line" />
      );
    case "AREA_CHART":
      return (
        <CartesianWidget definition={definition} rows={rows} kind="area" />
      );
    case "BAR_CHART":
      return <CartesianWidget definition={definition} rows={rows} kind="bar" />;
    case "HORIZONTAL_BAR_CHART":
      return (
        <CartesianWidget
          definition={definition}
          rows={rows}
          kind="horizontal-bar"
        />
      );
    case "STACKED_BAR_CHART":
      return (
        <CartesianWidget
          definition={definition}
          rows={rows}
          kind="stacked-bar"
        />
      );
    case "COMBO_CHART":
      return (
        <CartesianWidget definition={definition} rows={rows} kind="combo" />
      );
    case "PIE_CHART":
    case "DONUT_CHART":
      return <PieWidget definition={definition} rows={rows} />;
    case "GAUGE":
    case "PROGRESS_RING":
      return <GaugeWidget definition={definition} rows={rows} />;
    case "BULLET_CHART":
      return <BulletWidget definition={definition} rows={rows} />;
    case "FUNNEL_CHART":
      return <FunnelWidget definition={definition} rows={rows} />;
    case "WATERFALL_CHART":
      return <WaterfallWidget definition={definition} rows={rows} />;
    case "SCATTER_CHART":
    case "SCATTER_PLOT":
      return <ScatterWidget definition={definition} rows={rows} />;
    case "RADAR_CHART":
      return <RadarWidget definition={definition} rows={rows} />;
    case "TREEMAP":
      return <TreemapWidget definition={definition} rows={rows} />;
    case "HEATMAP":
      return <HeatmapWidget definition={definition} rows={rows} />;
    case "TIMELINE":
    case "GANTT_CHART":
      return <TimelineWidget definition={definition} rows={rows} />;
    case "SANKEY_DIAGRAM":
      return <FlowWidget definition={definition} rows={rows} />;
    case "MAP":
      return <MapWidget definition={definition} rows={rows} />;
    case "TABLE":
      return (
        <DataTable rows={rows} emptyMessage={definition.emptyStateMessage} />
      );
    case "ALERT_LIST":
      return <AlertList definition={definition} rows={rows} />;
    case "AI_INSIGHT":
    case "TEXT_INSIGHT":
      return (
        <InsightWidget
          definition={definition}
          rows={rows}
          insight={widget.insight}
        />
      );
    case "FILTER":
      return (
        <p className="text-sm text-muted-foreground">
          This filter is available in the global filter bar.
        </p>
      );
    default:
      return <UnsupportedWidget requestedType={String(definition.type)} />;
  }
}

function fields(definition: DashboardWidgetDefinition) {
  return {
    value:
      definition.visualization.valueField ?? definition.dataMapping.measures[0],
    category:
      definition.visualization.categoryField ??
      definition.visualization.xField ??
      definition.dataMapping.dimensions[0],
    x: definition.visualization.xField ?? definition.dataMapping.dimensions[0],
    y: definition.visualization.yField ?? definition.dataMapping.measures[0],
  };
}

function palette(definition: DashboardWidgetDefinition) {
  return PALETTES[definition.visualization.palette];
}

function semanticCategoryColor(value: unknown, fallback: string) {
  const label = String(value ?? "").toLowerCase();
  if (
    ["received", "completed", "approved", "success", "closed", "ok"].some(
      (token) => label.includes(token),
    )
  )
    return "#059669";
  if (
    ["rejected", "cancel", "failed", "critical", "overdue", "blocked"].some(
      (token) => label.includes(token),
    )
  )
    return "#dc2626";
  if (
    ["pending", "open", "waiting", "review", "progress", "hold"].some((token) =>
      label.includes(token),
    )
  )
    return "#d97706";
  return fallback;
}

function KpiWidget({
  definition,
  rows,
}: {
  definition: DashboardWidgetDefinition;
  rows: Record<string, unknown>[];
}) {
  const { value } = fields(definition);
  const previousField = definition.visualization.previousValueField;
  const targetField = definition.visualization.targetField;
  const current = numeric(rows[0]?.[value]);
  const previous = previousField ? numeric(rows[0]?.[previousField]) : null;
  const target = targetField ? numeric(rows[0]?.[targetField]) : null;
  const change =
    previous && previous !== 0
      ? ((current - previous) / Math.abs(previous)) * 100
      : null;
  const achievement = target && target !== 0 ? (current / target) * 100 : null;
  const sparkline = rows.map((row) => ({ value: numeric(row[value]) }));
  const positive = change == null || change >= 0;
  return (
    <div className="flex h-full flex-col justify-between gap-4 py-2">
      <div>
        <p className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
          {formatValue(current, definition)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {change != null ? (
            <Badge tone={positive ? "success" : "danger"}>
              {positive ? (
                <ArrowUpRight size={13} />
              ) : (
                <ArrowDownRight size={13} />
              )}
              {Math.abs(change).toFixed(1)}% vs previous
            </Badge>
          ) : null}
          {achievement != null ? (
            <Badge tone={achievement >= 100 ? "success" : "warning"}>
              <Target size={13} /> {achievement.toFixed(0)}% of target
            </Badge>
          ) : null}
        </div>
      </div>
      {sparkline.length > 1 ? (
        <div
          className="h-16"
          role="img"
          aria-label={`${definition.title} sparkline`}
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline}>
              <Area
                type="monotone"
                dataKey="value"
                stroke={palette(definition)[0]}
                fill="#dbeafe"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="text-xs leading-5 text-muted-foreground">
          {definition.businessQuestion}
        </p>
      )}
    </div>
  );
}

type CartesianKind =
  "line" | "area" | "bar" | "horizontal-bar" | "stacked-bar" | "combo";

function CartesianWidget({
  definition,
  rows,
  kind,
}: {
  definition: DashboardWidgetDefinition;
  rows: Record<string, unknown>[];
  kind: CartesianKind;
}) {
  const { x, y } = fields(definition);
  const measures = definition.dataMapping.measures.length
    ? definition.dataMapping.measures
    : [y];
  const colors = palette(definition);
  const categoryField =
    kind === "horizontal-bar"
      ? (definition.visualization.yField ??
        definition.visualization.categoryField ??
        definition.dataMapping.dimensions[0])
      : x;
  const measureFields =
    kind === "horizontal-bar"
      ? [
          definition.visualization.xField ??
            definition.visualization.valueField ??
            measures[0],
        ]
      : measures;
  const stockField = measures.find((field) =>
    /^(units?_in_stock|stock_(?:quantity|level|on_hand))$/i.test(field),
  );
  const reorderField = measures.find((field) =>
    /^(reorder_level|reorder_point|minimum_stock)$/i.test(field),
  );
  const isReorderRisk =
    kind === "horizontal-bar" && Boolean(stockField && reorderField);
  const sourceRows = isReorderRisk
    ? prepareReorderRiskRows(rows, categoryField, stockField!, reorderField!)
    : rows;
  const renderedMeasureFields = isReorderRisk
    ? [REORDER_SHORTFALL_FIELD]
    : measureFields;
  const chartRows = ["bar", "horizontal-bar", "stacked-bar"].includes(kind)
    ? aggregateCategoricalRows(sourceRows, categoryField, renderedMeasureFields)
        .filter((row) =>
          renderedMeasureFields.some((measure) => numeric(row[measure]) !== 0),
        )
        .slice(0, kind === "horizontal-bar" ? 12 : 16)
    : sourceRows;
  const data = chartRows.map((row) => ({
    ...row,
    ...Object.fromEntries(
      renderedMeasureFields.map((measure) => [measure, numeric(row[measure])]),
    ),
  }));
  const tooltip = (
    <Tooltip
      formatter={(value) => formatValue(value, definition)}
      labelFormatter={formatChartDateTime}
    />
  );
  const legend = definition.visualization.showLegend ? <Legend /> : null;
  if (!data.length)
    return (
      <div
        className="grid h-72 min-h-56 place-items-center rounded-lg border border-dashed bg-slate-50/60 px-6 text-center text-sm text-muted-foreground"
        role="status"
      >
        No non-zero values to display for the selected filters.
      </div>
    );
  if (kind === "horizontal-bar")
    return (
      <ChartFrame label={definition.title}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ left: 20, right: 12 }}
          accessibilityLayer
        >
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fontSize: 11 }}
            scale={isReorderRisk ? "log" : "auto"}
            domain={isReorderRisk ? [1, "auto"] : undefined}
          />
          <YAxis
            type="category"
            dataKey={categoryField}
            width={168}
            tick={{ fontSize: 11 }}
            tickFormatter={(value) => compactAxisLabel(value)}
            interval={0}
          />
          {tooltip}
          {legend}
          <Bar
            dataKey={renderedMeasureFields[0]}
            name={isReorderRisk ? "Units below reorder level" : undefined}
            fill={colors[0]}
            radius={[0, 5, 5, 0]}
          />
        </BarChart>
      </ChartFrame>
    );
  const axes = (
    <>
      <CartesianGrid strokeDasharray="3 3" vertical={false} />
      <XAxis
        dataKey={x}
        tick={{ fontSize: 11 }}
        tickFormatter={compactAxisLabel}
        minTickGap={24}
      />
      <YAxis tick={{ fontSize: 11 }} />
      {tooltip}
      {legend}
    </>
  );
  if (kind === "line")
    return (
      <ChartFrame label={definition.title}>
        <LineChart data={data} accessibilityLayer>
          {axes}
          {measures.map((measure, index) => (
            <Line
              key={measure}
              type="monotone"
              dataKey={measure}
              stroke={colors[index % colors.length]}
              strokeWidth={2.5}
              dot={data.length < 16}
            />
          ))}
        </LineChart>
      </ChartFrame>
    );
  if (kind === "area")
    return (
      <ChartFrame label={definition.title}>
        <AreaChart data={data} accessibilityLayer>
          {axes}
          {measures.map((measure, index) => (
            <Area
              key={measure}
              type="monotone"
              dataKey={measure}
              stroke={colors[index % colors.length]}
              fill={colors[index % colors.length]}
              fillOpacity={0.16}
              strokeWidth={2}
            />
          ))}
        </AreaChart>
      </ChartFrame>
    );
  if (kind === "combo")
    return (
      <ChartFrame label={definition.title}>
        <ComposedChart data={data} accessibilityLayer>
          {axes}
          <Bar dataKey={measures[0]} fill={colors[0]} radius={[4, 4, 0, 0]} />
          {measures[1] ? (
            <Line
              type="monotone"
              dataKey={measures[1]}
              stroke={colors[1]}
              strokeWidth={2.5}
            />
          ) : null}
        </ComposedChart>
      </ChartFrame>
    );
  return (
    <ChartFrame label={definition.title}>
      <BarChart data={data} accessibilityLayer>
        {axes}
        {measures.map((measure, index) => (
          <Bar
            key={measure}
            dataKey={measure}
            stackId={kind === "stacked-bar" ? "stack" : undefined}
            fill={colors[index % colors.length]}
            radius={kind === "stacked-bar" ? 0 : [5, 5, 0, 0]}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}

function PieWidget({ definition, rows }: WidgetProps) {
  const { value, category } = fields(definition);
  const data = aggregateCategoricalRows(rows, category, [value])
    .filter((row) => numeric(row[value]) >= 0)
    .slice(0, 16)
    .map((row) => ({ ...row, [value]: numeric(row[value]) }));
  return (
    <ChartFrame label={definition.title}>
      <PieChart accessibilityLayer>
        <Pie
          data={data}
          dataKey={value}
          nameKey={category}
          innerRadius={definition.type === "DONUT_CHART" ? 58 : 0}
          outerRadius={92}
          paddingAngle={3}
          stroke="#ffffff"
          strokeWidth={2}
        >
          {data.map((_, index) => (
            <Cell
              key={index}
              fill={semanticCategoryColor(
                data[index]?.[category],
                palette(definition)[index % palette(definition).length],
              )}
            />
          ))}
        </Pie>
        <Tooltip formatter={(entry) => formatValue(entry, definition)} />
        {definition.visualization.showLegend ? <Legend /> : null}
      </PieChart>
    </ChartFrame>
  );
}

function GaugeWidget({ definition, rows }: WidgetProps) {
  const { value } = fields(definition);
  const current = numeric(rows[0]?.[value]);
  const target = numeric(
    rows[0]?.[
      definition.visualization.targetField ??
        definition.visualization.maximumField ??
        ""
    ] ||
      definition.thresholds?.[0]?.value ||
      100,
  );
  const percent = target
    ? Math.max(0, Math.min(100, (current / target) * 100))
    : 0;
  const status =
    percent >= 100
      ? { label: "On target", color: "#059669", tone: "success" as const }
      : percent >= 75
        ? { label: "Watch", color: "#d97706", tone: "warning" as const }
        : { label: "At risk", color: "#dc2626", tone: "danger" as const };
  return (
    <div
      className="relative h-64"
      role="img"
      aria-label={`${definition.title}: ${formatValue(current, definition)} of ${formatValue(target, definition)}`}
    >
      <ResponsiveContainer width="100%" height="100%">
        <RadialBarChart
          innerRadius="68%"
          outerRadius="100%"
          data={[
            {
              value: percent,
              fill: status.color,
            },
          ]}
          startAngle={180}
          endAngle={0}
        >
          <RadialBar dataKey="value" background cornerRadius={8} />
        </RadialBarChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center">
        <p className="text-3xl font-semibold">
          {formatValue(current, definition)}
        </p>
        <p className="text-xs text-muted-foreground">
          Target {formatValue(target, definition)}
        </p>
        <Badge tone={status.tone} className="mt-2">
          {status.label} · {percent.toFixed(0)}%
        </Badge>
      </div>
    </div>
  );
}

function BulletWidget({ definition, rows }: WidgetProps) {
  const { value } = fields(definition);
  const current = numeric(rows[0]?.[value]);
  const target = numeric(
    rows[0]?.[definition.visualization.targetField ?? ""] ||
      definition.thresholds?.[0]?.value ||
      100,
  );
  const maximum = numeric(
    rows[0]?.[definition.visualization.maximumField ?? ""] ||
      Math.max(target, current) * 1.2,
  );
  return (
    <div
      className="flex flex-1 flex-col justify-center py-6"
      role="img"
      aria-label={`${definition.title}: ${current}, target ${target}`}
    >
      <div className="mb-3 flex items-end justify-between gap-4">
        <span className="text-3xl font-semibold">
          {formatValue(current, definition)}
        </span>
        <span className="text-xs text-muted-foreground">
          Target {formatValue(target, definition)}
        </span>
      </div>
      <div className="relative h-6 rounded-full bg-slate-100">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(100, (current / maximum) * 100)}%` }}
        />
        <span
          className="absolute inset-y-[-6px] w-0.5 bg-slate-900"
          style={{ left: `${Math.min(100, (target / maximum) * 100)}%` }}
        />
      </div>
    </div>
  );
}

function FunnelWidget({ definition, rows }: WidgetProps) {
  const stage = definition.visualization.stageField!;
  const value = definition.visualization.valueField!;
  const data = rows.map((row, index) => ({
    name: String(row[stage]),
    value: numeric(row[value]),
    fill: palette(definition)[index % palette(definition).length],
  }));
  return (
    <ChartFrame label={definition.title}>
      <FunnelChart accessibilityLayer>
        <Tooltip formatter={(entry) => formatValue(entry, definition)} />
        <Funnel dataKey="value" data={data} isAnimationActive>
          <LabelList
            position="right"
            fill="#334155"
            stroke="none"
            dataKey="name"
          />
        </Funnel>
      </FunnelChart>
    </ChartFrame>
  );
}

function WaterfallWidget({ definition, rows }: WidgetProps) {
  const { value, category } = fields(definition);
  const data = rows.reduce<
    Array<
      Record<string, unknown> & {
        start: number;
        delta: number;
        signed: number;
        running: number;
      }
    >
  >((items, row) => {
    const running = items.at(-1)?.running ?? 0;
    const delta = numeric(row[value]);
    const start = delta >= 0 ? running : running + delta;
    return [
      ...items,
      {
        ...row,
        start,
        delta: Math.abs(delta),
        signed: delta,
        running: running + delta,
      },
    ];
  }, []);
  return (
    <ChartFrame label={definition.title}>
      <BarChart data={data} accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis
          dataKey={category}
          tick={{ fontSize: 11 }}
          tickFormatter={compactAxisLabel}
        />
        <YAxis tick={{ fontSize: 11 }} />
        <Tooltip
          formatter={(_, name, item) =>
            name === "delta" ? formatValue(item.payload.signed, definition) : ""
          }
        />
        <ReferenceLine y={0} stroke="#64748b" />
        <Bar dataKey="start" stackId="waterfall" fill="transparent" />
        <Bar dataKey="delta" stackId="waterfall" radius={[4, 4, 0, 0]}>
          {data.map((item, index) => (
            <Cell key={index} fill={item.signed >= 0 ? "#059669" : "#dc2626"} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}

function ScatterWidget({ definition, rows }: WidgetProps) {
  const { x, y } = fields(definition);
  const data = rows.map((row) => ({
    ...row,
    [x]: numeric(row[x]),
    [y]: numeric(row[y]),
  }));
  return (
    <ChartFrame label={definition.title}>
      <ScatterChart accessibilityLayer>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis type="number" dataKey={x} name={x} tick={{ fontSize: 11 }} />
        <YAxis type="number" dataKey={y} name={y} tick={{ fontSize: 11 }} />
        <Tooltip cursor={{ strokeDasharray: "3 3" }} />
        <Scatter data={data} fill={palette(definition)[0]} />
      </ScatterChart>
    </ChartFrame>
  );
}

function RadarWidget({ definition, rows }: WidgetProps) {
  const { value, category } = fields(definition);
  const data = rows.map((row) => ({ ...row, [value]: numeric(row[value]) }));
  return (
    <ChartFrame label={definition.title}>
      <RadarChart data={data} accessibilityLayer>
        <PolarGrid />
        <PolarAngleAxis
          dataKey={category}
          tick={{ fontSize: 11 }}
          tickFormatter={compactAxisLabel}
        />
        <Radar
          dataKey={value}
          stroke={palette(definition)[0]}
          fill={palette(definition)[0]}
          fillOpacity={0.25}
        />
        <Tooltip formatter={(entry) => formatValue(entry, definition)} />
      </RadarChart>
    </ChartFrame>
  );
}

function TreemapWidget({ definition, rows }: WidgetProps) {
  const { value, category } = fields(definition);
  const data = rows.map((row) => ({
    name: String(row[category]),
    size: Math.max(0, numeric(row[value])),
  }));
  return (
    <ChartFrame label={definition.title}>
      <Treemap
        data={data}
        dataKey="size"
        nameKey="name"
        stroke="#fff"
        fill={palette(definition)[0]}
        aspectRatio={4 / 3}
      />
    </ChartFrame>
  );
}

function HeatmapWidget({ definition, rows }: WidgetProps) {
  const { value, category } = fields(definition);
  const max = Math.max(1, ...rows.map((row) => numeric(row[value])));
  return (
    <div
      className="grid grid-cols-2 gap-2 sm:grid-cols-3"
      role="img"
      aria-label={definition.title}
    >
      {rows.slice(0, 18).map((row, index) => {
        const intensity = numeric(row[value]) / max;
        return (
          <div
            key={index}
            className="min-h-20 rounded-lg p-3 text-xs"
            style={{
              backgroundColor: `color-mix(in srgb, ${palette(definition)[0]} ${Math.max(12, intensity * 90)}%, white)`,
            }}
          >
            <p className="font-semibold">{String(row[category] ?? "—")}</p>
            <p className="mt-1">{formatValue(row[value], definition)}</p>
          </div>
        );
      })}
    </div>
  );
}

function TimelineWidget({ definition, rows }: WidgetProps) {
  const label =
    definition.visualization.categoryField ??
    definition.dataMapping.dimensions[0];
  const start =
    definition.visualization.startField ?? definition.visualization.xField!;
  const end = definition.visualization.endField;
  return (
    <ol className="space-y-3" aria-label={definition.title}>
      {rows.slice(0, 20).map((row, index) => (
        <li
          key={index}
          className="relative border-l-2 border-blue-200 py-1 pl-5 before:absolute before:-left-[7px] before:top-2 before:size-3 before:rounded-full before:bg-primary"
        >
          <p className="text-sm font-semibold">
            {String(row[label] ?? "Event")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {formatDate(row[start])}
            {end ? ` → ${formatDate(row[end])}` : ""}
          </p>
        </li>
      ))}
    </ol>
  );
}

function FlowWidget({ definition, rows }: WidgetProps) {
  const source =
    definition.visualization.sourceField ??
    definition.dataMapping.dimensions[0];
  const target =
    definition.visualization.targetNodeField ??
    definition.dataMapping.dimensions[1];
  const value = fields(definition).value;
  const max = Math.max(1, ...rows.map((row) => numeric(row[value])));
  return (
    <div className="space-y-3" role="img" aria-label={definition.title}>
      {rows.slice(0, 15).map((row, index) => (
        <div
          key={index}
          className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs"
        >
          <span className="truncate text-right font-medium">
            {String(row[source] ?? "—")}
          </span>
          <span className="relative h-2 w-24 overflow-hidden rounded-full bg-slate-100 sm:w-36">
            <span
              className="block h-full rounded-full bg-primary"
              style={{
                width: `${Math.max(8, (numeric(row[value]) / max) * 100)}%`,
              }}
            />
          </span>
          <span className="truncate font-medium">
            {String(row[target] ?? "—")}
          </span>
        </div>
      ))}
    </div>
  );
}

function MapWidget({ definition, rows }: WidgetProps) {
  const lat = definition.visualization.latitudeField!;
  const lng = definition.visualization.longitudeField!;
  const value = fields(definition).value;
  const max = Math.max(1, ...rows.map((row) => numeric(row[value])));
  return (
    <div
      className="relative h-72 overflow-hidden rounded-xl bg-[linear-gradient(#dbeafe_1px,transparent_1px),linear-gradient(90deg,#dbeafe_1px,transparent_1px)] bg-[size:32px_32px]"
      role="img"
      aria-label={`${definition.title} coordinate map`}
    >
      {rows.slice(0, 100).map((row, index) => {
        const latitude = numeric(row[lat]);
        const longitude = numeric(row[lng]);
        const size = 8 + (numeric(row[value]) / max) * 22;
        return (
          <span
            key={index}
            className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-primary/75 shadow"
            title={`${latitude}, ${longitude}: ${formatValue(row[value], definition)}`}
            style={{
              left: `${((longitude + 180) / 360) * 100}%`,
              top: `${((90 - latitude) / 180) * 100}%`,
              width: size,
              height: size,
            }}
          />
        );
      })}
      <span className="absolute bottom-2 right-2 rounded bg-white/90 px-2 py-1 text-[10px] text-muted-foreground">
        Coordinate view
      </span>
    </div>
  );
}

function AlertList({ definition, rows }: WidgetProps) {
  const label =
    definition.visualization.categoryField ??
    definition.dataMapping.dimensions[0];
  const status = definition.visualization.statusField;
  return (
    <ul className="divide-y" aria-label={definition.title}>
      {rows.slice(0, 20).map((row, index) => {
        const tone = String(status ? row[status] : "warning").toLowerCase();
        return (
          <li key={index} className="flex items-start gap-3 py-3 first:pt-0">
            <span
              className={`mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg ${tone.includes("critical") || tone.includes("overdue") ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}
            >
              <BellRing size={15} />
            </span>
            <div>
              <p className="text-sm font-medium">
                {String(row[label] ?? "Alert")}
              </p>
              {status ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {String(row[status] ?? "")}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function InsightWidget({
  definition,
  rows,
  insight,
}: WidgetProps & { insight?: RenderedWidget["insight"] }) {
  const field =
    definition.dataMapping.dimensions[0] ?? definition.visualization.valueField;
  return (
    <div className="rounded-xl bg-blue-50/70 p-5">
      <Sparkles className="text-primary" size={20} />
      <p className="mt-3 text-sm leading-6 text-slate-700">
        {insight?.statement ??
          (field && rows[0]?.[field]
            ? String(rows[0][field])
            : definition.description || definition.businessQuestion)}
      </p>
      {insight?.title ? (
        <p className="mt-3 text-xs font-semibold text-primary">
          {insight.title}
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Grounded in the validated dashboard result set.
      </p>
    </div>
  );
}

type WidgetProps = {
  definition: DashboardWidgetDefinition;
  rows: Record<string, unknown>[];
};

function ChartFrame({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="h-72 min-h-56 w-full" role="img" aria-label={label}>
      <ResponsiveContainer width="100%" height="100%">
        {children as React.ReactElement}
      </ResponsiveContainer>
    </div>
  );
}

function WidgetState({
  title,
  message,
  loading,
  error,
}: {
  title: string;
  message: string;
  loading?: boolean;
  error?: boolean;
}) {
  return (
    <Card className={error ? "border-red-200" : "border-dashed"}>
      <CardContent className="flex min-h-44 flex-col items-center justify-center p-7 text-center">
        <CircleAlert
          className={
            error
              ? "text-destructive"
              : loading
                ? "animate-pulse text-primary motion-reduce:animate-none"
                : "text-muted-foreground"
          }
        />
        <p className="mt-3 font-semibold">{title}</p>
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}

function UnsupportedWidget({ requestedType }: { requestedType: string }) {
  if (process.env.NODE_ENV !== "production")
    console.warn("Unsupported dashboard visualization", { requestedType });
  return (
    <WidgetState
      title="Visualization not available"
      message={`The requested ${requestedType} visualization is preserved but has no renderer. No number-card fallback was applied.`}
      error
    />
  );
}

function DataTable({
  rows,
  emptyMessage,
}: {
  rows: Record<string, unknown>[];
  emptyMessage: string;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{
    column: string;
    descending: boolean;
  } | null>(null);
  const columns = Object.keys(rows[0] ?? {});
  const visibleRows = rows
    .filter(
      (row) =>
        !search ||
        Object.values(row).some((value) =>
          String(value ?? "")
            .toLowerCase()
            .includes(search.toLowerCase()),
        ),
    )
    .sort((left, right) => {
      if (!sort) return 0;
      const leftValue = String(left[sort.column] ?? "");
      const rightValue = String(right[sort.column] ?? "");
      const numericDifference = Number(leftValue) - Number(rightValue);
      const compared =
        Number.isFinite(numericDifference) && leftValue && rightValue
          ? numericDifference
          : leftValue.localeCompare(rightValue, undefined, { numeric: true });
      return sort.descending ? -compared : compared;
    })
    .slice(0, 10);
  if (!rows.length) return <p>{emptyMessage}</p>;
  return (
    <div className="overflow-hidden rounded-xl border bg-white/60">
      <div className="flex items-center justify-between gap-3 border-b bg-slate-50/80 px-3 py-2.5">
        <label className="relative min-w-0 flex-1">
          <Search
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            size={15}
          />
          <span className="sr-only">Search table</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search rows…"
            className="min-h-9 w-full rounded-lg border bg-white pl-8 pr-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-primary"
          />
        </label>
        <span className="shrink-0 text-xs text-muted-foreground">
          {visibleRows.length} of {rows.length}
        </span>
      </div>
      <div className="max-h-80 overflow-auto">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="sticky top-0 bg-slate-50">
            <tr>
              {columns.map((column) => (
                <th
                  key={column}
                  scope="col"
                  className="px-3 py-2.5 font-semibold"
                >
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 capitalize hover:text-primary"
                    onClick={() =>
                      setSort((current) =>
                        current?.column === column
                          ? { column, descending: !current.descending }
                          : { column, descending: false },
                      )
                    }
                  >
                    {column.replaceAll("_", " ")}
                    <span
                      aria-hidden="true"
                      className="text-[10px] text-muted-foreground"
                    >
                      {sort?.column === column
                        ? sort.descending
                          ? "↓"
                          : "↑"
                        : "↕"}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row, index) => (
              <tr
                key={index}
                className="border-t transition-colors hover:bg-blue-50/50"
              >
                {columns.map((column) => (
                  <td key={column} className="px-3 py-2.5 text-slate-700">
                    {String(row[column] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 10 ? (
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing the 10 most relevant rows. Export CSV for the full validated
          result.
        </p>
      ) : null}
    </div>
  );
}

function formatDate(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isNaN(date.getTime())
    ? String(value ?? "—")
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date);
}

function downloadCsv(widget: RenderedWidget) {
  if (!widget.rows.length) return;
  const columns = Object.keys(widget.rows[0]);
  const escape = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [
    columns.map(escape).join(","),
    ...widget.rows.map((row) =>
      columns.map((column) => escape(row[column])).join(","),
    ),
  ].join("\n");
  const link = document.createElement("a");
  link.href = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  link.download = `${widget.definition.id}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
