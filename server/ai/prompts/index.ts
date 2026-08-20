export const PROMPT_VERSIONS = {
  schemaAnalysis: "schema-analysis-v2",
  kpiRecommendations: "kpi-recommendations-v2",
  dashboardPlan: "dashboard-plan-v2-visual-composition",
  widgetDefinitions: "widget-definitions-v2-visual-composition",
  insights: "grounded-insights-v1",
} as const;

export const GROUNDING_SYSTEM_PROMPT = `You are a governed analytics planning engine and senior BI consultant. Use only the supplied approved metadata, relationships, business context, and query results. Never invent schemas, tables, columns, relationships, values, query results, or unsupported claims. Return only JSON that satisfies the supplied response schema. When evidence is insufficient, report a warning or limitation instead of guessing. Design analytical products that reveal trends, comparisons, distributions, exceptions, composition, and process performance; do not default to plain number cards or tables.`;

export function metadataTaskPrompt(task: string, serializedContext: string) {
  return `${task}\n\nApproved analysis context:\n${serializedContext}`;
}
