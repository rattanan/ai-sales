import type {
  BusinessSchemaAnalysis,
  DashboardPlan,
  DashboardWidgetDefinition,
  GeneratedInsight,
  KPIRecommendation,
  MetadataContext,
} from "@/schemas/analysis";
import { validateGroundedReadOnlySql } from "@/server/connectors/sql-grounding";
import { failure, success } from "@/types/result";
import { recommendVisualization } from "./dashboard-design";

function metadataIndex(context: MetadataContext) {
  const tables = new Map(
    context.tables.map((table) => [
      `${table.schema}.${table.name}`.toLowerCase(),
      new Map(
        table.columns.map((column) => [column.name.toLowerCase(), column]),
      ),
    ]),
  );
  return {
    tables,
    relationshipPairs: new Set(
      context.relationships.map((relationship) =>
        relationshipPair(relationship.fromTable, relationship.toTable),
      ),
    ),
  };
}

function relationshipPair(fromTable: string, toTable: string) {
  return [fromTable.toLowerCase(), toTable.toLowerCase()].sort().join("\u0000");
}

function resolveColumn(context: MetadataContext, reference: string) {
  const parts = reference.toLowerCase().split(".");
  if (parts.length !== 3) return null;
  const [schema, table, column] = parts;
  return (
    metadataIndex(context).tables.get(`${schema}.${table}`)?.get(column) ?? null
  );
}

function referencesAreGrounded(
  context: MetadataContext,
  tables: string[],
  columns: string[],
) {
  const index = metadataIndex(context);
  return (
    tables.every((table) => index.tables.has(table.toLowerCase())) &&
    columns.every((column) => Boolean(resolveColumn(context, column)))
  );
}

export function validateBusinessSchemaGrounding(
  analysis: BusinessSchemaAnalysis,
  context: MetadataContext,
) {
  const tableReferences = [
    ...analysis.entities.flatMap((entity) => entity.tables),
    ...analysis.factTables.map((finding) => finding.table),
    ...analysis.dimensionTables.map((finding) => finding.table),
    ...analysis.eventTables.map((finding) => finding.table),
    ...analysis.relationshipFindings.flatMap((finding) => [
      finding.fromTable,
      finding.toTable,
    ]),
  ];
  const columnReferences = [
    ...analysis.dateColumns,
    ...analysis.measureColumns,
    ...analysis.statusColumns,
    ...analysis.categoryColumns,
  ].map((finding) => finding.column);
  const index = metadataIndex(context);
  if (!referencesAreGrounded(context, tableReferences, columnReferences))
    return failure(
      "AI_INVALID_RESPONSE",
      "The schema analysis references metadata outside the approved scope.",
    );
  const relationshipFindings = analysis.relationshipFindings.filter((finding) =>
    index.relationshipPairs.has(
      relationshipPair(finding.fromTable, finding.toTable),
    ),
  );
  const omittedRelationshipCount =
    analysis.relationshipFindings.length - relationshipFindings.length;
  const dataQualityWarnings = [...analysis.dataQualityWarnings];
  if (omittedRelationshipCount && dataQualityWarnings.length < 50)
    dataQualityWarnings.push(
      `${omittedRelationshipCount} AI-proposed relationship finding(s) were omitted because no discovered relationship matched their table endpoints.`,
    );
  return success({
    ...analysis,
    relationshipFindings,
    dataQualityWarnings,
  });
}

const NUMERIC_TYPE =
  /^(tinyint|smallint|mediumint|int|integer|bigint|decimal|numeric|float|double|real|bit|number|binary_float|binary_double)/i;
const TEMPORAL_TYPE = /^(date|datetime|timestamp|time|year)/i;

export function validateKpiGrounding(
  kpi: KPIRecommendation,
  context: MetadataContext,
  maxRows: number,
) {
  if (!referencesAreGrounded(context, kpi.sourceTables, kpi.sourceColumns))
    return failure(
      "AI_INVALID_RESPONSE",
      "A KPI references a table or column outside the approved scope.",
    );
  const assumedColumns = kpi.filterAssumptions
    .map((assumption) => assumption.column)
    .filter((column): column is string => Boolean(column));
  if (!referencesAreGrounded(context, [], assumedColumns))
    return failure(
      "AI_INVALID_RESPONSE",
      "A KPI filter assumption references an unknown column.",
    );
  const filterableColumns =
    kpi.filterableDimensions?.map((dimension) => dimension.column) ?? [];
  if (!referencesAreGrounded(context, [], filterableColumns))
    return failure(
      "AI_INVALID_RESPONSE",
      "A KPI filter dimension references an unknown column.",
    );
  if (kpi.dateColumn) {
    const dateColumn = resolveColumn(context, kpi.dateColumn);
    if (!dateColumn || !TEMPORAL_TYPE.test(dateColumn.dataType))
      return failure(
        "AI_INVALID_RESPONSE",
        "A KPI date column is missing or not temporal.",
      );
  }
  if (["SUM", "AVERAGE", "RATIO"].includes(kpi.calculationType)) {
    const sourceColumns = kpi.sourceColumns.flatMap((reference) => {
      const column = resolveColumn(context, reference);
      return column ? [column] : [];
    });
    const numericCount = sourceColumns.filter((column) =>
      NUMERIC_TYPE.test(column.dataType),
    ).length;
    const temporalCount = sourceColumns.filter((column) =>
      TEMPORAL_TYPE.test(column.dataType),
    ).length;
    const compatible =
      kpi.calculationType === "SUM"
        ? numericCount >= 1
        : kpi.calculationType === "AVERAGE"
          ? numericCount >= 1 || temporalCount >= 2
          : sourceColumns.length >= 1;
    if (!compatible)
      return failure(
        "AI_INVALID_RESPONSE",
        "A KPI aggregation uses a missing or incompatible measure column.",
      );
  }
  const sql = validateGroundedReadOnlySql(kpi.proposedSql, context, maxRows);
  if (!sql.ok) return sql;
  return success({ ...kpi, proposedSql: sql.data.sql });
}

export function validateDashboardPlanGrounding(
  plan: DashboardPlan,
  context: MetadataContext,
  approvedKpiIds: Set<string>,
  queryIds: Set<string>,
) {
  const globalFilters = plan.globalFilters.filter((filter) =>
    referencesAreGrounded(context, [], [filter.column]),
  );
  let omittedKpiReferences = 0;
  let omittedQueryReferences = 0;
  const groundedSections = plan.sections.map((section) => {
    const relatedKpiIds = section.relatedKpiIds.filter((id) => {
      const grounded = approvedKpiIds.has(id);
      if (!grounded) omittedKpiReferences += 1;
      return grounded;
    });
    const relatedQueryIds = section.relatedQueryIds.filter((id) => {
      const grounded = queryIds.has(id);
      if (!grounded) omittedQueryReferences += 1;
      return grounded;
    });
    return { ...section, relatedKpiIds, relatedQueryIds };
  });
  const sections = groundedSections.filter(
    (section) =>
      section.relatedKpiIds.length > 0 || section.relatedQueryIds.length > 0,
  );
  if (plan.sections.length > 0 && sections.length === 0)
    return failure(
      "AI_INVALID_RESPONSE",
      "The dashboard plan has no sections supported by validated KPI or query results.",
    );
  const omittedFilters = plan.globalFilters.length - globalFilters.length;
  const omittedSections = plan.sections.length - sections.length;
  const warnings = [...plan.warnings];
  const appendWarning = (message: string) => {
    if (warnings.length < 30) warnings.push(message);
  };
  if (omittedKpiReferences)
    appendWarning(
      `${omittedKpiReferences} unsupported KPI reference(s) were omitted from the dashboard plan.`,
    );
  if (omittedQueryReferences)
    appendWarning(
      `${omittedQueryReferences} unsupported query reference(s) were omitted from the dashboard plan.`,
    );
  if (omittedFilters)
    appendWarning(
      `${omittedFilters} filter(s) were omitted because their columns are outside the approved metadata scope.`,
    );
  if (omittedSections)
    appendWarning(
      `${omittedSections} dashboard section(s) were omitted because no validated KPI or query supports them.`,
    );
  return success({ ...plan, sections, globalFilters, warnings });
}

export type QueryOutputFields = Map<string, Set<string>>;

export function validateWidgetGrounding(
  widgets: DashboardWidgetDefinition[],
  queryFields: QueryOutputFields,
  approvedFilters?: Map<string, "SELECT" | "MULTI_SELECT" | "DATE_RANGE">,
) {
  const ids = new Set<string>();
  const groundedWidgets: DashboardWidgetDefinition[] = [];
  for (const widget of widgets) {
    if (ids.has(widget.id))
      return failure(
        "AI_INVALID_RESPONSE",
        "Widget identifiers must be unique.",
      );
    ids.add(widget.id);
    if (
      approvedFilters &&
      widget.filters?.some(
        (filter) => approvedFilters.get(filter.id) !== filter.control,
      )
    )
      return failure(
        "AI_INVALID_RESPONSE",
        "A widget uses an unknown or incompatible dashboard filter.",
      );
    if (!widget.queryDefinitionId) continue;
    const fields = queryFields.get(widget.queryDefinitionId);
    if (!fields)
      return failure(
        "AI_INVALID_RESPONSE",
        "A widget references an unknown query definition.",
      );
    // Oracle returns unquoted aliases in uppercase while AI plans commonly use
    // lowercase aliases. Preserve the actual result-schema casing for runtime
    // field lookup, but validate aliases case-insensitively.
    const canonicalFields = new Map(
      [...fields].map((field) => [field.toLowerCase(), field]),
    );
    const canonical = (field: string | undefined) =>
      field ? (canonicalFields.get(field.toLowerCase()) ?? field) : field;
    const canonicalRequired = (field: string) => canonical(field) ?? field;
    const normalizedWidget: DashboardWidgetDefinition = {
      ...widget,
      dataMapping: {
        ...widget.dataMapping,
        dimensions: widget.dataMapping.dimensions.map(canonicalRequired),
        measures: widget.dataMapping.measures.map(canonicalRequired),
      },
      visualization: {
        ...widget.visualization,
        xField: canonical(widget.visualization.xField),
        yField: canonical(widget.visualization.yField),
        categoryField: canonical(widget.visualization.categoryField),
        valueField: canonical(widget.visualization.valueField),
        seriesField: canonical(widget.visualization.seriesField),
        previousValueField: canonical(widget.visualization.previousValueField),
        targetField: canonical(widget.visualization.targetField),
        maximumField: canonical(widget.visualization.maximumField),
        statusField: canonical(widget.visualization.statusField),
        stageField: canonical(widget.visualization.stageField),
        startField: canonical(widget.visualization.startField),
        endField: canonical(widget.visualization.endField),
        sourceField: canonical(widget.visualization.sourceField),
        targetNodeField: canonical(widget.visualization.targetNodeField),
        latitudeField: canonical(widget.visualization.latitudeField),
        longitudeField: canonical(widget.visualization.longitudeField),
      },
      filters: widget.filters?.map((filter) => ({
        ...filter,
        field: canonical(filter.field)!,
      })),
    };
    const mappedFields = [
      ...normalizedWidget.dataMapping.dimensions,
      ...normalizedWidget.dataMapping.measures,
      normalizedWidget.visualization.xField,
      normalizedWidget.visualization.yField,
      normalizedWidget.visualization.categoryField,
      normalizedWidget.visualization.valueField,
      normalizedWidget.visualization.seriesField,
      normalizedWidget.visualization.previousValueField,
      normalizedWidget.visualization.targetField,
      normalizedWidget.visualization.maximumField,
      normalizedWidget.visualization.statusField,
      normalizedWidget.visualization.stageField,
      normalizedWidget.visualization.startField,
      normalizedWidget.visualization.endField,
      normalizedWidget.visualization.sourceField,
      normalizedWidget.visualization.targetNodeField,
      normalizedWidget.visualization.latitudeField,
      normalizedWidget.visualization.longitudeField,
      ...(normalizedWidget.filters?.map((filter) => filter.field) ?? []),
    ].filter((field): field is string => Boolean(field));
    if (mappedFields.some((field) => !fields.has(field)))
      return failure(
        "AI_INVALID_RESPONSE",
        "A widget maps a field that is absent from its validated query result.",
      );
    groundedWidgets.push(normalizedWidget);
  }
  return success(groundedWidgets);
}

export function validateInsightGrounding(
  insights: GeneratedInsight[],
  widgetIds: Set<string>,
  queryIds: Set<string>,
) {
  if (
    insights.some(
      (insight) =>
        insight.supportingWidgetIds.some((id) => !widgetIds.has(id)) ||
        insight.supportingQueryIds.some((id) => !queryIds.has(id)),
    )
  )
    return failure(
      "AI_INVALID_RESPONSE",
      "An insight references an unknown widget or query.",
    );
  return success(insights);
}

export function deterministicWidgetRecommendation(input: {
  singleMetric?: boolean;
  timeSeries?: boolean;
  detailedRecords?: boolean;
  percentToTarget?: boolean;
  categoryCount?: number;
}) {
  return recommendVisualization({
    singleMetric: input.singleMetric,
    hasTarget: input.percentToTarget,
    timeSeries: input.timeSeries,
    detailedRecords: input.detailedRecords,
    categoryCount: input.categoryCount,
    partToWhole: input.categoryCount != null,
  });
}
