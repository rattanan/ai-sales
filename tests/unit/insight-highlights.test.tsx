// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InsightHighlights } from "@/components/dashboard/insight-highlights";
import {
  acknowledgeInsightAction,
  analyzeFilteredInsightsAction,
} from "@/features/insights/actions";

vi.mock("@/features/insights/actions", () => ({
  acknowledgeInsightAction: vi.fn(),
  analyzeFilteredInsightsAction: vi.fn(),
}));

const insight = {
  title: "Late orders",
  statement: "Three late orders need review.",
  confidence: 0.9,
  caveats: [],
};

describe("dashboard insight controls", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => cleanup());

  it("offers re-analysis after filters change and replaces the findings", async () => {
    vi.mocked(analyzeFilteredInsightsAction).mockResolvedValue({
      ok: true,
      data: {
        insights: [{ ...insight, title: "Filtered late orders" }],
        generatedAt: "2026-07-19T10:00:00.000Z",
      },
    });
    render(
      <InsightHighlights
        dashboardId="cmrq85aey025hin17oq44zo4k"
        insights={[insight]}
      />,
    );

    window.dispatchEvent(
      new CustomEvent("dashboard:filters-changed", {
        detail: { region: ["North"] },
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: /analyze filtered data/i }),
    );

    await waitFor(() =>
      expect(analyzeFilteredInsightsAction).toHaveBeenCalledWith({
        dashboardId: "cmrq85aey025hin17oq44zo4k",
        filters: { region: ["North"] },
      }),
    );
    expect(await screen.findByText("Filtered late orders")).toBeTruthy();
  });

  it("acknowledges, hides, and retains a finding in history", async () => {
    vi.mocked(acknowledgeInsightAction).mockResolvedValue({
      ok: true,
      data: { acknowledgedAt: "2026-07-19T10:05:00.000Z" },
    });
    render(
      <InsightHighlights
        dashboardId="cmrq85aey025hin17oq44zo4k"
        insights={[insight]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /acknowledge/i }));
    await waitFor(() => expect(screen.queryByText(insight.title)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /history/i }));

    expect(await screen.findByText(insight.title)).toBeTruthy();
    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });
});
