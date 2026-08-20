import { z } from "zod";

export const metadataColumnContextSchema = z.object({
  name: z.string(),
  dataType: z.string(),
  nullable: z.boolean(),
  primaryKey: z.boolean(),
  databaseComment: z.string().nullable().optional(),
  semanticDescription: z.string().nullable().optional(),
});

export const metadataTableContextSchema = z.object({
  schema: z.string(),
  name: z.string(),
  kind: z.enum(["TABLE", "VIEW"]),
  estimatedRowCount: z.string().nullable(),
  databaseComment: z.string().nullable().optional(),
  semanticDescription: z.string().nullable().optional(),
  columns: z.array(metadataColumnContextSchema),
  omittedColumnCount: z.number().int().nonnegative(),
  sampleRows: z.array(z.record(z.string(), z.unknown())),
});

export const metadataRelationshipContextSchema = z.object({
  name: z.string(),
  fromTable: z.string(),
  fromColumn: z.string(),
  toTable: z.string(),
  toColumn: z.string(),
});

export const metadataContextSchema = z.object({
  version: z.literal(1),
  dataSourceType: z.enum(["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"]),
  dataSourceName: z.string(),
  tables: z.array(metadataTableContextSchema),
  relationships: z.array(metadataRelationshipContextSchema),
  businessObjective: z.object({
    area: z.string().nullable(),
    objective: z.string(),
    questions: z.string().nullable(),
    desiredKpis: z.string().nullable(),
    targetAudience: z.string().nullable(),
    reportingPeriod: z.string().nullable(),
    importantFilters: z.string().nullable(),
  }),
  dashboardPreferences: z.object({
    layout: z.string(),
    visualStyle: z.string(),
    theme: z.string(),
  }),
  scopeReduction: z.object({
    selectedTableCount: z.number().int().nonnegative(),
    includedTableCount: z.number().int().nonnegative(),
    omittedTables: z.array(z.string()),
    omittedColumns: z.array(
      z.object({ table: z.string(), count: z.number().int().positive() }),
    ),
    sampleDataIncluded: z.boolean(),
    sensitiveDataMasked: z.boolean(),
    warnings: z.array(z.string()),
  }),
});

export type MetadataContext = z.infer<typeof metadataContextSchema>;

export const tableReferenceSchema = z.string().regex(/^[^.]+\.[^.]+$/);
export const columnReferenceSchema = z.string().regex(/^[^.]+\.[^.]+\.[^.]+$/);

const confidenceSchema = z.number().min(0).max(1);
const tableFindingSchema = z.object({
  table: tableReferenceSchema,
  reason: z.string().min(1).max(1_000),
  confidence: confidenceSchema,
});
const columnFindingSchema = z.object({
  column: columnReferenceSchema,
  reason: z.string().min(1).max(1_000),
  confidence: confidenceSchema,
});

export const businessSchemaAnalysisSchema = z.object({
  summary: z.string().min(1).max(4_000),
  businessDomain: z.string().min(1).max(200),
  entities: z
    .array(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().min(1).max(1_000),
        tables: z.array(tableReferenceSchema).min(1).max(20),
        confidence: confidenceSchema,
      }),
    )
    .max(30),
  factTables: z.array(tableFindingSchema).max(30),
  dimensionTables: z.array(tableFindingSchema).max(30),
  eventTables: z.array(tableFindingSchema).max(30),
  dateColumns: z.array(columnFindingSchema).max(100),
  measureColumns: z.array(columnFindingSchema).max(100),
  statusColumns: z.array(columnFindingSchema).max(100),
  categoryColumns: z.array(columnFindingSchema).max(100),
  relationshipFindings: z
    .array(
      z.object({
        relationshipName: z.string().min(1).max(255),
        fromTable: tableReferenceSchema,
        toTable: tableReferenceSchema,
        finding: z.string().min(1).max(1_000),
        confidence: confidenceSchema,
      }),
    )
    .max(100),
  dataQualityWarnings: z.array(z.string().min(1).max(1_000)).max(50),
  clarificationQuestions: z.array(z.string().min(1).max(1_000)).max(20),
});

export type BusinessSchemaAnalysis = z.infer<
  typeof businessSchemaAnalysisSchema
>;

export const kpiRecommendationSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  businessQuestion: z.string().min(1).max(1_000),
  calculationType: z.enum([
    "COUNT",
    "SUM",
    "AVERAGE",
    "RATIO",
    "DISTINCT_COUNT",
  ]),
  sourceTables: z.array(tableReferenceSchema).min(1).max(10),
  sourceColumns: z.array(columnReferenceSchema).max(20),
  dateColumn: columnReferenceSchema.optional(),
  aggregationPeriod: z
    .enum(["DAY", "WEEK", "MONTH", "QUARTER", "YEAR"])
    .optional(),
  filterAssumptions: z
    .array(
      z.object({
        description: z.string().min(1).max(500),
        column: columnReferenceSchema.optional(),
        assumedValue: z.union([z.string(), z.number(), z.boolean()]).optional(),
      }),
    )
    .max(20),
  filterableDimensions: z
    .array(
      z.object({
        column: columnReferenceSchema,
        resultField: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,63}$/),
        type: z.enum(["DATE", "CATEGORY"]),
      }),
    )
    .max(12)
    .optional(),
  proposedSql: z.string().min(1).max(100_000),
  displayFormat: z.enum(["NUMBER", "CURRENCY", "PERCENTAGE", "DURATION"]),
  confidence: confidenceSchema,
  limitations: z.array(z.string().min(1).max(500)).max(20),
});

export function kpiRecommendationsSchema(maxRecommendations: number) {
  return z.object({
    recommendations: z.array(kpiRecommendationSchema).max(maxRecommendations),
  });
}

export type KPIRecommendation = z.infer<typeof kpiRecommendationSchema>;

export const dashboardWidgetTypeSchema = z.enum([
  "KPI",
  "STAT",
  "LINE_CHART",
  "AREA_CHART",
  "BAR_CHART",
  "HORIZONTAL_BAR_CHART",
  "STACKED_BAR_CHART",
  "COMBO_CHART",
  "DONUT_CHART",
  "PIE_CHART",
  "GAUGE",
  "BULLET_CHART",
  "PROGRESS_RING",
  "FUNNEL_CHART",
  "WATERFALL_CHART",
  "SCATTER_CHART",
  "SCATTER_PLOT",
  "RADAR_CHART",
  "TREEMAP",
  "HEATMAP",
  "TIMELINE",
  "GANTT_CHART",
  "SANKEY_DIAGRAM",
  "MAP",
  "TABLE",
  "ALERT_LIST",
  "AI_INSIGHT",
  "TEXT_INSIGHT",
  "FILTER",
]);

export const editableDashboardWidgetTypes = [
  "KPI",
  "STAT",
  "LINE_CHART",
  "AREA_CHART",
  "BAR_CHART",
  "HORIZONTAL_BAR_CHART",
  "STACKED_BAR_CHART",
  "COMBO_CHART",
  "DONUT_CHART",
  "PIE_CHART",
  "GAUGE",
  "PROGRESS_RING",
  "BULLET_CHART",
  "FUNNEL_CHART",
  "WATERFALL_CHART",
  "SCATTER_CHART",
  "SCATTER_PLOT",
  "RADAR_CHART",
  "TREEMAP",
  "HEATMAP",
  "TIMELINE",
  "GANTT_CHART",
  "SANKEY_DIAGRAM",
  "MAP",
  "TABLE",
  "ALERT_LIST",
  "AI_INSIGHT",
  "TEXT_INSIGHT",
  "FILTER",
] as const;

export const editableDashboardWidgetTypeSchema = z.enum(
  editableDashboardWidgetTypes,
);

export const dashboardFilterSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
  label: z.string().min(1).max(120),
  column: columnReferenceSchema,
  control: z.enum(["SELECT", "MULTI_SELECT", "DATE_RANGE"]),
});

export const dashboardPlanSchema = z.object({
  title: z.string().min(1).max(120),
  subtitle: z.string().max(240).optional(),
  narrative: z.string().min(1).max(4_000),
  targetAudience: z.array(z.string().min(1).max(120)).max(10),
  sections: z.preprocess(
    (value) =>
      Array.isArray(value)
        ? value.slice(0, 20).map((section) => {
            if (!section || typeof section !== "object") return section;
            const candidate = section as Record<string, unknown>;
            const rawPriority = Number(candidate.priority);
            // Priority only controls display order. OpenAI-compatible models
            // commonly continue numbering past 10, which should not invalidate
            // an otherwise grounded plan.
            return {
              ...candidate,
              priority: Number.isFinite(rawPriority)
                ? Math.min(10, Math.max(1, Math.round(rawPriority)))
                : 10,
            };
          })
        : value,
    z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
          title: z.string().min(1).max(120),
          purpose: z.string().min(1).max(1_000),
          businessQuestion: z.string().min(1).max(1_000),
          recommendedWidgetTypes: z.array(dashboardWidgetTypeSchema).max(10),
          priority: z.number().int().min(1).max(10),
          layoutSize: z.enum(["SMALL", "MEDIUM", "LARGE", "FULL"]),
          relatedKpiIds: z.array(z.string()).max(20),
          relatedQueryIds: z.array(z.string()).max(20),
        }),
      )
      .max(20),
  ),
  globalFilters: z.array(dashboardFilterSchema).max(12),
  template: z
    .enum([
      "EXECUTIVE_OVERVIEW",
      "OPERATIONAL_MONITORING",
      "SALES_PERFORMANCE",
      "INVENTORY_PROCUREMENT",
      "MAINTENANCE_MANAGEMENT",
      "FINANCIAL_ANALYSIS",
    ])
    .optional(),
  refreshRecommendation: z.string().max(500).optional(),
  warnings: z.array(z.string().min(1).max(1_000)).max(30),
});

export type DashboardPlan = z.infer<typeof dashboardPlanSchema>;

export const dashboardWidgetDefinitionSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
    type: dashboardWidgetTypeSchema,
    title: z.string().min(1).max(120),
    description: z.string().max(1_000).optional(),
    businessQuestion: z.string().min(1).max(1_000),
    visualizationReason: z.string().min(1).max(1_000).optional(),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "PRIMARY"]).optional(),
    queryDefinitionId: z.string().optional(),
    layout: z.object({
      x: z.number().int().min(0).max(11),
      y: z.number().int().min(0).max(200),
      width: z.number().int().min(1).max(12),
      height: z.number().int().min(2).max(12),
    }),
    visualization: z.preprocess(
      (value) => {
        if (typeof value === "string") return { palette: "BLUE" };
        if (!value || typeof value !== "object") return value;
        const candidate = value as Record<string, unknown>;
        const palette = String(candidate.palette ?? "BLUE").toUpperCase();
        return {
          ...candidate,
          palette: ["BLUE", "EMERALD", "AMBER", "SLATE"].includes(palette)
            ? palette
            : "BLUE",
        };
      },
      z.object({
        xField: z.string().optional(),
        yField: z.string().optional(),
        categoryField: z.string().optional(),
        valueField: z.string().optional(),
        seriesField: z.string().optional(),
        previousValueField: z.string().optional(),
        targetField: z.string().optional(),
        maximumField: z.string().optional(),
        statusField: z.string().optional(),
        stageField: z.string().optional(),
        startField: z.string().optional(),
        endField: z.string().optional(),
        sourceField: z.string().optional(),
        targetNodeField: z.string().optional(),
        latitudeField: z.string().optional(),
        longitudeField: z.string().optional(),
        showLegend: z.boolean().default(true),
        palette: z.enum(["BLUE", "EMERALD", "AMBER", "SLATE"]),
      }),
    ),
    dataMapping: z.object({
      dimensions: z.array(z.string()).max(10).default([]),
      measures: z.array(z.string()).max(10),
    }),
    formatting: z.object({
      displayFormat: z.enum([
        "NUMBER",
        "CURRENCY",
        "PERCENTAGE",
        "DURATION",
        "TEXT",
      ]),
      decimals: z.number().int().min(0).max(6).default(0),
      currency: z.string().length(3).optional(),
      compact: z.boolean().default(false),
      unit: z.string().max(20).optional(),
      prefix: z.string().max(20).optional(),
      suffix: z.string().max(20).optional(),
    }),
    filters: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z0-9][a-z0-9_-]{1,63}$/),
          label: z.string().min(1).max(120),
          control: z.enum(["SELECT", "MULTI_SELECT", "DATE_RANGE"]),
          field: z.string().min(1).max(255),
        }),
      )
      .max(12)
      .optional(),
    interaction: z
      .object({
        crossFilter: z.boolean().default(false),
        drillDown: z.boolean().default(false),
        export: z.boolean().default(true),
      })
      .optional(),
    thresholds: z
      .array(
        z.object({
          value: z.number(),
          operator: z.enum(["GT", "GTE", "LT", "LTE"]),
          tone: z.enum(["POSITIVE", "WARNING", "NEGATIVE", "NEUTRAL"]),
          label: z.string().max(120).optional(),
        }),
      )
      .max(10)
      .optional(),
    emptyStateMessage: z.string().min(1).max(240),
    limitations: z.array(z.string().min(1).max(500)).max(20).optional(),
  })
  .refine((widget) => widget.layout.x + widget.layout.width <= 12, {
    message: "Widget layout exceeds the 12-column grid",
    path: ["layout", "width"],
  })
  .refine(
    (widget) =>
      ["TEXT_INSIGHT", "AI_INSIGHT", "FILTER"].includes(widget.type) ||
      Boolean(widget.queryDefinitionId),
    {
      message: "This widget type requires a query definition",
      path: ["queryDefinitionId"],
    },
  )
  .superRefine((widget, context) => {
    const visual = widget.visualization;
    const issue = (message: string, path: (string | number)[]) =>
      context.addIssue({ code: "custom", message, path });
    if (
      ["GAUGE", "BULLET_CHART", "PROGRESS_RING"].includes(widget.type) &&
      !visual.targetField &&
      !visual.maximumField &&
      !widget.thresholds?.length
    )
      issue("Target-aware widgets require a target, maximum, or threshold", [
        "visualization",
        "targetField",
      ]);
    if (
      widget.type === "FUNNEL_CHART" &&
      (!visual.stageField || !visual.valueField)
    )
      issue("Funnel widgets require stage and value fields", ["visualization"]);
    if (
      ["LINE_CHART", "AREA_CHART", "COMBO_CHART"].includes(widget.type) &&
      (!visual.xField || !visual.yField)
    )
      issue("Time-series widgets require x and y fields", ["visualization"]);
    if (widget.type === "SCATTER_PLOT" && (!visual.xField || !visual.yField))
      issue("Scatter plots require numeric x and y fields", ["visualization"]);
    if (
      widget.type === "MAP" &&
      (!visual.latitudeField || !visual.longitudeField)
    )
      issue("Map widgets require latitude and longitude fields", [
        "visualization",
      ]);
  });

export function widgetDefinitionsSchema(maxWidgets: number) {
  return z.object({
    // Some OpenAI-compatible models occasionally exceed a requested array
    // length. Keep the first bounded widget definitions rather than rejecting
    // an otherwise valid dashboard response.
    widgets: z.preprocess(
      (value) => (Array.isArray(value) ? value.slice(0, maxWidgets) : value),
      z.array(dashboardWidgetDefinitionSchema).max(maxWidgets),
    ),
  });
}

export type DashboardWidgetDefinition = z.infer<
  typeof dashboardWidgetDefinitionSchema
>;

export const generatedInsightSchema = z.object({
  title: z.string().min(1).max(120),
  statement: z.string().min(1).max(2_000),
  supportingWidgetIds: z.array(z.string()).min(1).max(20),
  supportingQueryIds: z.array(z.string()).min(1).max(20),
  confidence: confidenceSchema,
  caveats: z.array(z.string().min(1).max(500)).max(20),
});

export function generatedInsightsSchema(maxInsights: number) {
  return z.object({
    insights: z.array(generatedInsightSchema).max(maxInsights),
  });
}

export type GeneratedInsight = z.infer<typeof generatedInsightSchema>;

export const sqlRepairSchema = z.object({
  sql: z.string().min(1).max(100_000),
});

export const recommendationDecisionSchema = z.object({
  recommendationId: z.string().min(1),
  decision: z.enum(["APPROVED", "REJECTED"]),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).optional(),
  decisionNote: z.string().trim().max(1_000).optional(),
  widgetType: editableDashboardWidgetTypeSchema.optional(),
  gaugeTarget: z.coerce.number().positive().optional(),
});

export const dashboardWidgetEditSchema = z.object({
  widgetId: z.string().min(1),
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1_000).optional(),
  widgetType: editableDashboardWidgetTypeSchema,
  gaugeTarget: z.coerce.number().positive().optional(),
});

export const dashboardWidgetDeleteSchema = z.object({
  widgetId: z.string().min(1),
});

export const bulkRecommendationApprovalSchema = z.object({
  analysisJobId: z.string().min(1),
  recommendationIds: z
    .array(z.string().min(1))
    .max(100)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Recommendation selections must be unique.",
    })
    .optional(),
});
