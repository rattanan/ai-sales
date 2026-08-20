import { describe, expect, it } from "vitest";
import {
  dashboardWidgetDefinitionSchema,
  type BusinessSchemaAnalysis,
  type DashboardPlan,
  type KPIRecommendation,
  type MetadataContext,
} from "@/schemas/analysis";
import {
  deterministicWidgetRecommendation,
  validateBusinessSchemaGrounding,
  validateDashboardPlanGrounding,
  validateInsightGrounding,
  validateKpiGrounding,
  validateWidgetGrounding,
} from "@/server/ai/grounding";
import {
  recommendVisualization,
  scoreDashboardQuality,
  validateDashboardQuality,
} from "@/server/ai/dashboard-design";

const context: MetadataContext = {
  version: 1,
  dataSourceType: "MYSQL",
  dataSourceName: "Commerce",
  tables: [
    {
      schema: "shop",
      name: "orders",
      kind: "TABLE",
      estimatedRowCount: "50",
      omittedColumnCount: 0,
      sampleRows: [],
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
        },
        {
          name: "order_total",
          dataType: "decimal(10,2)",
          nullable: false,
          primaryKey: false,
        },
        {
          name: "ordered_at",
          dataType: "datetime",
          nullable: false,
          primaryKey: false,
        },
      ],
    },
  ],
  relationships: [],
  businessObjective: {
    area: "Sales",
    objective: "Monitor order revenue.",
    questions: null,
    desiredKpis: "Revenue",
    targetAudience: "Leaders",
    reportingPeriod: "Monthly",
    importantFilters: null,
  },
  dashboardPreferences: {
    layout: "EXECUTIVE_OVERVIEW",
    visualStyle: "CLEAN_PROFESSIONAL",
    theme: "BLUE",
  },
  scopeReduction: {
    selectedTableCount: 1,
    includedTableCount: 1,
    omittedTables: [],
    omittedColumns: [],
    sampleDataIncluded: false,
    sensitiveDataMasked: false,
    warnings: [],
  },
};

const analysis: BusinessSchemaAnalysis = {
  summary: "Orders are the primary transaction entity.",
  businessDomain: "Commerce",
  entities: [
    {
      name: "Order",
      description: "Customer order",
      tables: ["shop.orders"],
      confidence: 0.9,
    },
  ],
  factTables: [
    { table: "shop.orders", reason: "Transactions", confidence: 0.9 },
  ],
  dimensionTables: [],
  eventTables: [],
  dateColumns: [
    {
      column: "shop.orders.ordered_at",
      reason: "Order date",
      confidence: 1,
    },
  ],
  measureColumns: [
    {
      column: "shop.orders.order_total",
      reason: "Revenue measure",
      confidence: 1,
    },
  ],
  statusColumns: [],
  categoryColumns: [],
  relationshipFindings: [],
  dataQualityWarnings: [],
  clarificationQuestions: [],
};

const kpi: KPIRecommendation = {
  id: "total_revenue",
  name: "Total revenue",
  description: "Sum of order totals.",
  businessQuestion: "How much revenue was ordered?",
  calculationType: "SUM",
  sourceTables: ["shop.orders"],
  sourceColumns: ["shop.orders.order_total"],
  dateColumn: "shop.orders.ordered_at",
  aggregationPeriod: "MONTH",
  filterAssumptions: [],
  proposedSql: "SELECT SUM(order_total) AS total_revenue FROM shop.orders",
  displayFormat: "CURRENCY",
  confidence: 0.9,
  limitations: [],
};

const relationshipContext: MetadataContext = {
  ...context,
  tables: [
    ...context.tables,
    {
      schema: "shop",
      name: "customers",
      kind: "TABLE",
      estimatedRowCount: "20",
      omittedColumnCount: 0,
      sampleRows: [],
      columns: [
        {
          name: "id",
          dataType: "int",
          nullable: false,
          primaryKey: true,
        },
      ],
    },
  ],
  relationships: [
    {
      name: "orders_ibfk_customer",
      fromTable: "shop.orders",
      fromColumn: "customer_id",
      toTable: "shop.customers",
      toColumn: "id",
    },
  ],
};

describe("AI artifact grounding", () => {
  it("accepts metadata-grounded schema and KPI output", () => {
    expect(validateBusinessSchemaGrounding(analysis, context).ok).toBe(true);
    expect(validateKpiGrounding(kpi, context, 100).ok).toBe(true);
  });

  it("grounds readable relationship labels by discovered table endpoints", () => {
    const result = validateBusinessSchemaGrounding(
      {
        ...analysis,
        relationshipFindings: [
          {
            relationshipName: "Order to customer",
            fromTable: "shop.orders",
            toTable: "shop.customers",
            finding: "Each order belongs to a customer.",
            confidence: 0.9,
          },
        ],
      },
      relationshipContext,
    );
    expect(result.ok).toBe(true);
  });

  it("omits relationship findings without a discovered endpoint pair", () => {
    const result = validateBusinessSchemaGrounding(
      {
        ...analysis,
        relationshipFindings: [
          {
            relationshipName: "Invented self relation",
            fromTable: "shop.orders",
            toTable: "shop.orders",
            finding: "Unsupported relation.",
            confidence: 0.5,
          },
        ],
      },
      relationshipContext,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.relationshipFindings).toEqual([]);
    expect(result.data.dataQualityWarnings.at(-1)).toContain("were omitted");
  });

  it("rejects invented schema fields and incompatible KPI measures", () => {
    expect(
      validateBusinessSchemaGrounding(
        {
          ...analysis,
          measureColumns: [
            {
              column: "shop.orders.profit",
              reason: "Invented",
              confidence: 0.5,
            },
          ],
        },
        context,
      ).ok,
    ).toBe(false);
    expect(
      validateKpiGrounding(
        {
          ...kpi,
          sourceColumns: ["shop.orders.ordered_at"],
        },
        context,
        100,
      ).ok,
    ).toBe(false);
  });

  it("allows filter columns alongside a numeric aggregation measure", () => {
    const result = validateKpiGrounding(
      {
        ...kpi,
        sourceColumns: ["shop.orders.order_total", "shop.orders.ordered_at"],
      },
      context,
      100,
    );
    expect(result.ok).toBe(true);
  });

  it("allows temporal duration averages without a numeric source column", () => {
    const result = validateKpiGrounding(
      {
        ...kpi,
        calculationType: "AVERAGE",
        sourceColumns: ["shop.orders.ordered_at", "shop.orders.ordered_at"],
        proposedSql:
          "SELECT AVG(DATEDIFF(ordered_at, ordered_at)) AS average_days FROM shop.orders",
      },
      context,
      100,
    );
    expect(result.ok).toBe(true);
  });

  it("omits invented dashboard plan references without discarding grounded sections", () => {
    const plan: DashboardPlan = {
      title: "Revenue overview",
      narrative: "Monitor validated revenue performance.",
      targetAudience: ["Leaders"],
      sections: [
        {
          id: "revenue",
          title: "Revenue",
          purpose: "Show revenue.",
          businessQuestion: "How much revenue was ordered?",
          recommendedWidgetTypes: ["KPI"],
          priority: 1,
          layoutSize: "SMALL",
          relatedKpiIds: ["total_revenue"],
          relatedQueryIds: ["query-1", "invented-query"],
        },
        {
          id: "invented",
          title: "Unsupported forecast",
          purpose: "Show an unsupported forecast.",
          businessQuestion: "What will revenue be?",
          recommendedWidgetTypes: ["LINE_CHART"],
          priority: 2,
          layoutSize: "MEDIUM",
          relatedKpiIds: [],
          relatedQueryIds: ["forecast-query"],
        },
      ],
      globalFilters: [
        {
          id: "order_date",
          label: "Order date",
          column: "shop.orders.ordered_at",
          control: "DATE_RANGE",
        },
        {
          id: "invented_filter",
          label: "Invented",
          column: "shop.orders.missing",
          control: "SELECT",
        },
      ],
      warnings: [],
    };
    const result = validateDashboardPlanGrounding(
      plan,
      context,
      new Set(["total_revenue"]),
      new Set(["query-1"]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sections).toHaveLength(1);
    expect(result.data.sections[0]?.relatedQueryIds).toEqual(["query-1"]);
    expect(result.data.globalFilters).toHaveLength(1);
    expect(result.data.warnings.join(" ")).toContain("unsupported query");
  });

  it("rejects widgets mapped to fields absent from query results", () => {
    const widget = dashboardWidgetDefinitionSchema.parse({
      id: "revenue_kpi",
      type: "KPI",
      title: "Revenue",
      businessQuestion: "Revenue?",
      queryDefinitionId: "query-1",
      layout: { x: 0, y: 0, width: 3, height: 2 },
      visualization: { valueField: "missing", palette: "BLUE" },
      dataMapping: { dimensions: [], measures: ["missing"] },
      formatting: { displayFormat: "CURRENCY" },
      emptyStateMessage: "No revenue data",
    });
    expect(
      validateWidgetGrounding(
        [widget],
        new Map([["query-1", new Set(["total_revenue"])]]),
      ).ok,
    ).toBe(false);
  });

  it("rejects insights without real widget and query support", () => {
    expect(
      validateInsightGrounding(
        [
          {
            title: "Revenue",
            statement: "Revenue is 100.",
            supportingWidgetIds: ["invented-widget"],
            supportingQueryIds: ["query-1"],
            confidence: 0.8,
            caveats: [],
          },
        ],
        new Set(["widget-1"]),
        new Set(["query-1"]),
      ).ok,
    ).toBe(false);
  });

  it("applies deterministic visualization recommendations", () => {
    expect(deterministicWidgetRecommendation({ singleMetric: true })).toBe(
      "KPI",
    );
    expect(deterministicWidgetRecommendation({ timeSeries: true })).toBe(
      "LINE_CHART",
    );
    expect(deterministicWidgetRecommendation({ categoryCount: 5 })).toBe(
      "DONUT_CHART",
    );
    expect(deterministicWidgetRecommendation({ detailedRecords: true })).toBe(
      "TABLE",
    );
  });

  it("selects charts from analytical signals instead of defaulting to cards", () => {
    expect(recommendVisualization({ timeSeries: true })).toBe("LINE_CHART");
    expect(recommendVisualization({ funnelStages: true })).toBe("FUNNEL_CHART");
    expect(
      recommendVisualization({ singleMetric: true, hasTarget: true }),
    ).toBe("GAUGE");
    expect(recommendVisualization({ categoryCount: 6 })).toBe("BAR_CHART");
    expect(
      recommendVisualization({ partToWhole: true, categoryCount: 5 }),
    ).toBe("DONUT_CHART");
    expect(
      recommendVisualization({ partToWhole: true, categoryCount: 12 }),
    ).toBe("HORIZONTAL_BAR_CHART");
  });

  it("rejects number-only dashboard compositions", () => {
    const widgets = Array.from({ length: 4 }, (_, index) =>
      dashboardWidgetDefinitionSchema.parse({
        id: `metric_${index}`,
        type: "KPI",
        title: `Metric ${index}`,
        businessQuestion: `What is metric ${index}?`,
        queryDefinitionId: `query-${index}`,
        layout: { x: index * 3, y: 0, width: 3, height: 2 },
        visualization: { valueField: "value", palette: "BLUE" },
        dataMapping: { dimensions: [], measures: ["value"] },
        formatting: { displayFormat: "NUMBER" },
        emptyStateMessage: "No data",
      }),
    );
    const score = scoreDashboardQuality(widgets);
    expect(score.visualDiversityScore).toBe(0);
    expect(validateDashboardQuality(widgets).ok).toBe(false);
  });
});
