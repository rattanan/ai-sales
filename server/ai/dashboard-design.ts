import type {
  DashboardPlan,
  DashboardWidgetDefinition,
} from "@/schemas/analysis";
import { failure, success } from "@/types/result";

export const DASHBOARD_TEMPLATES = {
  EXECUTIVE_OVERVIEW: {
    name: "Executive Overview",
    composition: [
      "3–6 compact KPI cards with comparison or target context",
      "one full-width performance trend",
      "target achievement and business composition charts",
      "AI insight panel",
    ],
  },
  OPERATIONAL_MONITORING: {
    name: "Operational Monitoring",
    composition: [
      "status KPIs",
      "large workload trend",
      "SLA target visualization",
      "alerts and exception table",
    ],
  },
  SALES_PERFORMANCE: {
    name: "Sales Performance",
    composition: [
      "revenue KPI comparisons",
      "large revenue trend",
      "sales funnel",
      "product mix and region performance",
      "top customers detail",
    ],
  },
  INVENTORY_PROCUREMENT: {
    name: "Inventory and Procurement",
    composition: [
      "inventory health KPIs",
      "large inventory trend",
      "stock status distribution",
      "low-stock ranking",
      "supplier and purchase-order performance",
    ],
  },
  MAINTENANCE_MANAGEMENT: {
    name: "Maintenance Management",
    composition: [
      "asset readiness and backlog KPIs",
      "large work-order trend",
      "readiness target visualization",
      "maintenance timeline",
      "downtime causes and overdue work",
    ],
  },
  FINANCIAL_ANALYSIS: {
    name: "Financial Analysis",
    composition: [
      "revenue, cost, profit, and margin KPIs",
      "large monthly trend",
      "profit waterfall",
      "budget versus actual",
      "cost composition",
    ],
  },
} as const;

const PLAIN_TYPES = new Set([
  "KPI",
  "STAT",
  "TABLE",
  "ALERT_LIST",
  "AI_INSIGHT",
  "TEXT_INSIGHT",
  "FILTER",
]);
const NUMBER_TYPES = new Set(["KPI", "STAT"]);

export type VisualizationSignals = {
  singleMetric?: boolean;
  hasPreviousPeriod?: boolean;
  hasTarget?: boolean;
  timeSeries?: boolean;
  detailedRecords?: boolean;
  categoryCount?: number;
  partToWhole?: boolean;
  funnelStages?: boolean;
  positiveAndNegative?: boolean;
  statusDistribution?: boolean;
  geographic?: boolean;
  schedule?: boolean;
  correlation?: boolean;
  hierarchical?: boolean;
  flow?: boolean;
  numericDistribution?: boolean;
  multidimensional?: boolean;
  exceptions?: boolean;
};

export function recommendVisualization(input: VisualizationSignals) {
  if (input.funnelStages) return "FUNNEL_CHART" as const;
  if (input.positiveAndNegative) return "WATERFALL_CHART" as const;
  if (input.geographic) return "MAP" as const;
  if (input.schedule) return "TIMELINE" as const;
  if (input.correlation) return "SCATTER_PLOT" as const;
  if (input.hierarchical) return "TREEMAP" as const;
  if (input.flow) return "SANKEY_DIAGRAM" as const;
  if (input.numericDistribution) return "HEATMAP" as const;
  if (input.multidimensional) return "RADAR_CHART" as const;
  if (input.exceptions) return "ALERT_LIST" as const;
  if (input.hasTarget) return input.singleMetric ? "GAUGE" : "BULLET_CHART";
  if (input.timeSeries) return "LINE_CHART" as const;
  if (input.detailedRecords) return "TABLE" as const;
  if (input.statusDistribution || input.partToWhole)
    return (input.categoryCount ?? 0) > 7
      ? ("HORIZONTAL_BAR_CHART" as const)
      : ("DONUT_CHART" as const);
  if (input.categoryCount != null)
    return input.categoryCount > 10
      ? ("HORIZONTAL_BAR_CHART" as const)
      : ("BAR_CHART" as const);
  if (input.singleMetric || input.hasPreviousPeriod) return "KPI" as const;
  return "BAR_CHART" as const;
}

export type DashboardQualityScore = {
  visualDiversityScore: number;
  businessRelevanceScore: number;
  layoutQualityScore: number;
  dataValidityScore: number;
  overallScore: number;
  warnings: string[];
};

export function scoreDashboardQuality(
  widgets: DashboardWidgetDefinition[],
  plan?: DashboardPlan,
  options?: { filtersAvailable?: boolean },
): DashboardQualityScore {
  const warnings: string[] = [];
  const chartWidgets = widgets.filter(
    (widget) => !PLAIN_TYPES.has(widget.type),
  );
  const numberWidgets = widgets.filter((widget) =>
    NUMBER_TYPES.has(widget.type),
  );
  const chartRatio = widgets.length ? chartWidgets.length / widgets.length : 0;
  const numberRatio = widgets.length
    ? numberWidgets.length / widgets.length
    : 0;
  const visualTypes = new Set(chartWidgets.map((widget) => widget.type));
  const normalDashboard = widgets.length >= 5;
  const hasPrimary = chartWidgets.some(
    (widget) =>
      widget.priority === "PRIMARY" ||
      (widget.layout.width >= 8 && widget.layout.height >= 4),
  );
  const duplicateQuestions =
    new Set(
      widgets.map((widget) => widget.businessQuestion.trim().toLowerCase()),
    ).size !== widgets.length;

  if (normalDashboard && chartRatio < 0.6)
    warnings.push("At least 60% of widgets must be visual charts.");
  if (normalDashboard && numberRatio > 0.3)
    warnings.push("Plain KPI/stat widgets exceed 30% of the composition.");
  if (widgets.length >= 4 && !chartWidgets.length)
    warnings.push("The dashboard cannot contain only number cards and tables.");
  if (normalDashboard && visualTypes.size < 3)
    warnings.push(
      "Use at least three visualization types when data supports it.",
    );
  if (widgets.length >= 3 && !hasPrimary)
    warnings.push("The dashboard needs one large primary visualization.");
  if (duplicateQuestions)
    warnings.push("Multiple widgets answer the same business question.");
  if (
    normalDashboard &&
    options?.filtersAvailable &&
    !(plan?.globalFilters.length ?? 0)
  )
    warnings.push("The dashboard plan needs functional global filters.");

  const visualDiversityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(chartRatio * 70 + Math.min(visualTypes.size, 3) * 10),
    ),
  );
  const businessRelevanceScore = Math.max(
    0,
    100 - (duplicateQuestions ? 35 : 0) - (widgets.length ? 0 : 100),
  );
  const layoutQualityScore = Math.max(
    0,
    100 - (widgets.length >= 3 && !hasPrimary ? 45 : 0),
  );
  const dataValidityScore = widgets.every(
    (widget) =>
      widget.title.trim() &&
      widget.businessQuestion.trim() &&
      widget.layout.x + widget.layout.width <= 12,
  )
    ? 100
    : 0;
  const overallScore = Math.round(
    visualDiversityScore * 0.35 +
      businessRelevanceScore * 0.25 +
      layoutQualityScore * 0.2 +
      dataValidityScore * 0.2,
  );
  return {
    visualDiversityScore,
    businessRelevanceScore,
    layoutQualityScore,
    dataValidityScore,
    overallScore,
    warnings,
  };
}

export function validateDashboardQuality(
  widgets: DashboardWidgetDefinition[],
  plan?: DashboardPlan,
  options?: { filtersAvailable?: boolean },
) {
  const score = scoreDashboardQuality(widgets, plan, options);
  if ((widgets.length >= 5 && score.overallScore < 70) || score.warnings.length)
    return failure(
      "AI_INVALID_RESPONSE",
      "The generated dashboard does not meet the visual quality requirements.",
      { diagnostics: { qualityScore: JSON.stringify(score) } },
    );
  return success(score);
}

export const DASHBOARD_DESIGN_PROMPT = `Act as a senior BI consultant and dashboard designer. Design the dashboard as one coherent analytical composition, not a collection of cards.

Mandatory design rules:
- Do not default to KPI cards or tables. Prefer trends, comparisons, distributions, composition, exception monitoring, and process conversion.
- For a normal dashboard, use 3–6 compact KPI/stat cards, at least one large primary chart, 2–4 supporting charts, at most one detail table, and a separate AI insight section.
- At least 60% of widgets must be visual charts, no more than 30% may be KPI/stat cards, and use at least three chart types when supported by the data.
- Every KPI needs a previous-period comparison, target, status, or sparkline. Never create a gauge without a real target, threshold, or maximum.
- Use line/area for ordered time series; vertical bars for category comparison; horizontal bars for Top N or many categories; donut only for non-negative part-to-whole data with at most seven categories; funnel for ordered conversion stages; waterfall for signed contributions; scatter for correlation; timeline/Gantt for schedules; treemap for hierarchy; Sankey for flow; and tables only for record inspection.
- Every widget must have a meaningful title, business question, visualization reason, unit/format, and deliberate 12-column layout. The primary chart should normally be width 8–12 and height 4–6.
- Define date-range and relevant category filters from real metadata. Bind each widget filter only to fields present in its validated query result. Never invent a field.
- Match the chart grain to its displayed dimensions. A status/category chart must produce one aggregated value per displayed category; do not expose vendor, item, location, or date grain unless that field is visibly encoded. Never create repeated category labels such as Received or Rejected across hidden dimensions.
- Insight widgets must contain a useful grounded description or be backed by generated insights; never emit an empty placeholder as the intended content.
- Avoid duplicate widgets that show the same metric and dimension. Use a restrained coherent palette and semantic status colors.
- Use only approved KPI IDs, query IDs, metadata fields, and query result fields. Explain limitations instead of guessing.`;
