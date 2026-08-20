// @vitest-environment jsdom

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DashboardWidgetDefinition } from "@/schemas/analysis";
import {
  aggregateCategoricalRows,
  applyDashboardFilters,
  datePresetRange,
  DashboardRenderer,
  DashboardWidgetRenderer,
  formatChartDateTime,
  prepareReorderRiskRows,
} from "@/components/dashboard/dashboard-renderer";

vi.mock("@/features/analysis/actions", () => ({
  reorderDashboardWidgetAction: vi.fn(),
}));

const definition: DashboardWidgetDefinition = {
  id: "orders_table",
  type: "TABLE",
  title: "Orders",
  businessQuestion: "Which orders need review?",
  queryDefinitionId: "query-1",
  layout: { x: 0, y: 0, width: 6, height: 4 },
  visualization: { showLegend: false, palette: "BLUE" },
  dataMapping: { dimensions: ["region", "period"], measures: ["orders"] },
  formatting: {
    displayFormat: "NUMBER",
    decimals: 0,
    compact: false,
  },
  filters: [
    {
      id: "region",
      label: "Region",
      control: "SELECT",
      field: "region",
    },
    {
      id: "period",
      label: "Period",
      control: "DATE_RANGE",
      field: "period",
    },
  ],
  emptyStateMessage: "No orders",
};

const rows = [
  { region: "North", period: "2026-01-01", orders: 12 },
  { region: "South", period: "2026-02-01", orders: 8 },
];

describe("dashboard renderer states and filters", () => {
  it("formats chart timestamps without seconds or milliseconds", () => {
    expect(formatChartDateTime("2022-06-30T17:00:00.000Z")).toBe(
      "2022-06-30T17:00",
    );
  });

  it("shows controlled empty and query error states", () => {
    const { rerender } = render(
      <DashboardWidgetRenderer
        widget={{ recordId: "widget", definition, rows: [] }}
      />,
    );
    expect(screen.getByText("No matching data")).toBeTruthy();
    rerender(
      <DashboardWidgetRenderer
        widget={{
          recordId: "widget",
          definition,
          rows,
          error: "The validated query could not be executed.",
        }}
      />,
    );
    expect(screen.getByText("Query unavailable")).toBeTruthy();
  });

  it("never silently turns an unsupported visualization into a KPI", () => {
    render(
      <DashboardWidgetRenderer
        widget={{
          recordId: "unsupported",
          definition: {
            ...definition,
            type: "UNKNOWN_VISUAL" as DashboardWidgetDefinition["type"],
          },
          rows,
        }}
      />,
    );
    expect(screen.getByText("Visualization not available")).toBeTruthy();
    expect(screen.queryByText("12")).toBeNull();
  });

  it("applies date and category filters to widget rows", () => {
    expect(
      applyDashboardFilters(rows, definition.filters, {
        region: ["South"],
        "period:from": ["2026-02-01"],
      }),
    ).toEqual([rows[1]]);
  });

  it("builds deterministic date-filter presets", () => {
    const now = new Date(2026, 6, 19, 12);
    expect(datePresetRange("TODAY", now)).toEqual({
      from: "2026-07-19",
      to: "2026-07-19",
    });
    expect(datePresetRange("LAST_MONTH", now)).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
    expect(datePresetRange("LAST_YEAR", now)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });

  it("aggregates duplicate chart categories before rendering", () => {
    expect(
      aggregateCategoricalRows(
        [
          { status: "Received", count: 2, vendor: "A" },
          { status: "Received", count: 3, vendor: "B" },
          { status: "Rejected", count: 1, vendor: "C" },
        ],
        "status",
        ["count"],
      ).map((row) => ({ status: row.status, count: row.count })),
    ).toEqual([
      { status: "Received", count: 5 },
      { status: "Rejected", count: 1 },
    ]);
  });

  it("keeps only actionable reorder shortages and removes placeholder labels", () => {
    expect(
      prepareReorderRiskRows(
        [
          { item: "Pump A", stock: 2, reorder: 10 },
          { item: "Pump B", stock: 10, reorder: 10 },
          { item: "Pump C", stock: 0, reorder: 4 },
          { item: "***", stock: 0, reorder: 12 },
          { item: "-", stock: 0, reorder: 8 },
          { item: "Unused", stock: 0, reorder: 0 },
        ],
        "item",
        "stock",
        "reorder",
      ).map((row) => ({ item: row.item, shortfall: row.reorder_shortfall })),
    ).toEqual([
      { item: "Pump A", shortfall: 8 },
      { item: "Pump C", shortfall: 4 },
    ]);
  });

  it("shows grounded insight content even without query rows", () => {
    render(
      <DashboardWidgetRenderer
        widget={{
          recordId: "insight",
          definition: {
            ...definition,
            id: "procurement_insight",
            type: "TEXT_INSIGHT",
            queryDefinitionId: undefined,
            description: "Review supplier concentration and rejected orders.",
          },
          rows: [],
          insight: {
            title: "Supplier concentration",
            statement: "Three suppliers account for most purchase value.",
            caveats: [],
          },
        }}
      />,
    );
    expect(
      screen.getByText("Three suppliers account for most purchase value."),
    ).toBeTruthy();
    expect(screen.queryByText("No matching data")).toBeNull();
  });

  it("renders responsive layout metadata and updates widgets from filters", () => {
    const { container } = render(
      <DashboardRenderer
        canReorder={false}
        widgets={[{ recordId: "widget", definition, rows }]}
      />,
    );
    expect(
      container
        .querySelector<HTMLElement>(".dashboard-widget")
        ?.style.getPropertyValue("--widget-tablet-width"),
    ).toBe("12");
    fireEvent.change(screen.getByLabelText("Region"), {
      target: { value: "South" },
    });
    const tableRows = container.querySelectorAll("tbody tr");
    expect(tableRows).toHaveLength(1);
    expect(tableRows[0].textContent).toContain("South");
    expect(tableRows[0].textContent).not.toContain("North");
  });
});
