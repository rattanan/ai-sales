# Rich dashboard engine

## Generation architecture

The governed pipeline remains metadata analysis → KPI/query generation → SQL validation and execution → dashboard plan → widget definitions → insights → human approval → immutable dashboard version. This preserves the existing authorization, connector, SQL-grounding, audit, and approval boundaries.

The rich-dashboard changes add visual intent at three points:

1. KPI planning identifies filterable date/category dimensions and asks query output to expose stable aliases where the analytical grain permits.
2. Dashboard planning selects one of six business composition templates and defines grounded global filters before widgets are generated.
3. Widget generation maps only validated query-result fields, then passes grounding and dashboard-quality validation. A composition that fails quality validation receives one provider repair attempt before the stage fails safely.

## Why dashboards previously became number-only

The old contract exposed only ten widget types, the planning prompt contained no composition budget, KPI rendering used only the first result value, and validation checked field existence without checking visual diversity. A provider could therefore satisfy the schema with a grid of KPI cards and tables. Filters rendered as isolated selects and did not affect other widgets.

## Widget contract and renderer

`schemas/analysis.ts` is the public persisted contract. It includes explicit visualization fields for axes, series, previous values, targets, stages, schedules, flows, and coordinates; formatting and units; filter bindings; interaction flags; priority; and visualization rationale.

`DashboardWidgetRenderer` performs an explicit type switch. It never silently converts an unknown type to a KPI. Development logs retain the requested type and the UI displays a controlled unsupported state.

The renderer supports KPI/stat, line, area, vertical/horizontal/stacked bar, combo, pie/donut, gauge/progress ring, bullet, funnel, waterfall, scatter, radar, treemap, heatmap, timeline/Gantt, Sankey-style flow, coordinate map, detail table, alert list, and AI insight. Recharts is retained for its supported Cartesian/radial chart families; small purpose-built HTML/SVG views cover timeline, heatmap, flow, and coordinate visualization without adding another large client dependency.

Every widget has loading, empty, and sanitized error states. Applicable widgets expose CSV export. Chart containers are responsive and use restrained semantic palettes. Existing persisted types, including `SCATTER_CHART`, continue to parse.

## Filters

Widget definitions bind a plan filter ID to a real field in that widget's validated query result. Grounding rejects unknown filter IDs or absent result fields. The global filter bar merges compatible bindings and applies date/category selections to every bound widget in one client state update.

Filtering currently operates over the persisted bounded preview. This is deterministic and does not weaken SQL controls. A future server-side refresh contract can bind validated parameters and re-execute guarded queries for larger ranges.

## Quality scoring

The engine records:

- visual diversity
- business relevance
- layout quality
- data validity
- overall score and warnings

For normal dashboards, at least 60% of widgets must be visual charts, KPI/stat cards may not exceed 30%, at least three visual types are expected, and one large primary visualization is required. Number-only compositions, duplicate business questions, missing functional filters when filterable metadata exists, and invalid layouts are rejected. Overall quality must be at least 70.

## Templates

The planning prompt can select Executive Overview, Operational Monitoring, Sales Performance, Inventory and Procurement, Maintenance Management, or Financial Analysis. Templates describe hierarchy rather than hard-coding fields, so all generated references still pass discovered-metadata and query-output grounding.

## Demonstration and tests

Run `npm run db:seed` to create `Visual Analytics Showcase`. It demonstrates filters and ten deliberately varied widgets using realistic inventory/procurement data without requiring a live source credential.

Unit tests cover visualization recommendation rules, number-only quality rejection, result-field grounding, controlled unsupported states, empty/query-error states, responsive layout metadata, and category/date filtering. Existing connector and analysis tests remain unchanged.
