import { describe, expect, it } from "vitest";
import { registerSchema } from "@/schemas/auth";
import { envSchema } from "@/schemas/env";
import {
  dashboardPlanSchema,
  bulkRecommendationApprovalSchema,
  dashboardWidgetDefinitionSchema,
  recommendationDecisionSchema,
} from "@/schemas/analysis";
import {
  databaseConnectionSchema,
  dashboardObjectiveSchema,
  widgetConfigSchema,
} from "@/schemas/data-source";
import {
  acknowledgeInsightSchema,
  filteredInsightAnalysisSchema,
} from "@/schemas/dashboard-insights";

describe("application schemas", () => {
  it("accepts a strong registration", () => {
    expect(
      registerSchema.safeParse({
        name: "Ada Lovelace",
        email: "ADA@example.com",
        password: "SecurePassword1",
      }).success,
    ).toBe(true);
  });
  it("rejects weak registration passwords", () => {
    expect(
      registerSchema.safeParse({
        name: "Ada",
        email: "ada@example.com",
        password: "password",
      }).success,
    ).toBe(false);
  });
  it("coerces a valid database port", () => {
    const result = databaseConnectionSchema.parse({
      type: "MYSQL",
      name: "Reporting",
      host: "localhost",
      port: "3306",
      databaseName: "analytics",
      username: "reader",
      password: "secret",
      sslEnabled: false,
      connectionOptions: {},
    });
    expect(result.port).toBe(3306);
  });
  it("requires a meaningful dashboard objective", () => {
    expect(
      dashboardObjectiveSchema.safeParse({
        dataSourceId: "source",
        name: "Sales",
        businessArea: "Sales",
        businessObjective: "too short",
      }).success,
    ).toBe(false);
  });
  it("versions widget JSON", () => {
    expect(widgetConfigSchema.parse({ version: 1 }).visualization).toEqual({});
  });
  it("validates filtered insight analysis and acknowledgement payloads", () => {
    const dashboardId = "cmrq85aey025hin17oq44zo4k";
    expect(
      filteredInsightAnalysisSchema.safeParse({
        dashboardId,
        filters: { region: ["North"], "period:from": ["2026-07-01"] },
      }).success,
    ).toBe(true);
    expect(
      acknowledgeInsightSchema.safeParse({
        dashboardId,
        insight: {
          title: "Late orders",
          statement: "Three late orders need review.",
          confidence: 0.9,
          caveats: [],
        },
      }).success,
    ).toBe(true);
    expect(
      acknowledgeInsightSchema.safeParse({
        dashboardId,
        insight: {
          title: "Invalid confidence",
          statement: "This should fail validation.",
          confidence: 1.1,
          caveats: [],
        },
      }).success,
    ).toBe(false);
  });
  it("parses Phase 1 limits and environment booleans safely", () => {
    const result = envSchema.parse({
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
      AUTH_SECRET: "test-auth-secret-with-at-least-32-characters",
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      AI_SEND_SAMPLE_DATA: "false",
      AI_MASK_SENSITIVE_DATA: "true",
      AI_MAX_TABLES: "12",
      QUERY_MAX_ROWS: "500",
    });
    expect(result.AI_SEND_SAMPLE_DATA).toBe(false);
    expect(result.AI_MASK_SENSITIVE_DATA).toBe(true);
    expect(result.AI_MAX_TABLES).toBe(12);
    expect(result.QUERY_MAX_ROWS).toBe(500);
    expect(result.AI_STREAM_INACTIVITY_TIMEOUT_MS).toBe(180_000);
  });
  it("enforces dashboard widget grid and review decisions", () => {
    expect(
      dashboardWidgetDefinitionSchema.safeParse({
        id: "bad-layout",
        type: "KPI",
        title: "Revenue",
        businessQuestion: "Revenue?",
        queryDefinitionId: "query",
        layout: { x: 10, y: 0, width: 4, height: 2 },
        visualization: { valueField: "revenue", palette: "BLUE" },
        dataMapping: { dimensions: [], measures: ["revenue"] },
        formatting: { displayFormat: "CURRENCY" },
        emptyStateMessage: "No revenue",
      }).success,
    ).toBe(false);
    expect(
      recommendationDecisionSchema.safeParse({
        recommendationId: "recommendation",
        decision: "APPROVED",
        title: "Approved revenue",
        widgetType: "BAR_CHART",
      }).success,
    ).toBe(true);
  });
  it("normalizes harmless dashboard-plan and visualization enum drift", () => {
    expect(
      dashboardPlanSchema.safeParse({
        title: "Plan",
        narrative: "Plan narrative",
        targetAudience: [],
        sections: Array.from({ length: 22 }, (_, index) => ({
          id: `section-${index}`,
          title: "Section",
          purpose: "Purpose",
          businessQuestion: "Question?",
          recommendedWidgetTypes: ["KPI"],
          priority: index + 1,
          layoutSize: "SMALL",
          relatedKpiIds: [],
          relatedQueryIds: [],
        })),
        globalFilters: [],
        warnings: [],
      }).success,
    ).toBe(true);
    const widget = dashboardWidgetDefinitionSchema.safeParse({
      id: "normalized-widget",
      type: "KPI",
      title: "Count",
      businessQuestion: "How many?",
      queryDefinitionId: "query",
      layout: { x: 0, y: 0, width: 3, height: 2 },
      visualization: { valueField: "count", palette: "purple" },
      dataMapping: { measures: ["count"] },
      formatting: { displayFormat: "NUMBER" },
      emptyStateMessage: "No data",
    });
    expect(widget.success).toBe(true);
    if (widget.success) expect(widget.data.visualization.palette).toBe("BLUE");
  });
  it("validates unique bulk recommendation selections", () => {
    expect(
      bulkRecommendationApprovalSchema.safeParse({
        analysisJobId: "job",
        recommendationIds: ["kpi-1", "widget-1"],
      }).success,
    ).toBe(true);
    expect(
      bulkRecommendationApprovalSchema.safeParse({
        analysisJobId: "job",
        recommendationIds: ["kpi-1", "kpi-1"],
      }).success,
    ).toBe(false);
  });
});
