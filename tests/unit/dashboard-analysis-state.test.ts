import { describe, expect, it } from "vitest";
import {
  canStartDashboardAnalysis,
  dashboardObjectiveChangedSinceAnalysis,
} from "@/server/services/dashboard-analysis-state";

const dashboard = {
  name: "Revenue dashboard",
  businessArea: "Sales",
  businessObjective: "Monitor quarterly revenue performance",
  businessQuestions: "Where is growth slowing?",
  desiredKpis: "Revenue, growth rate",
  targetUsers: "Leadership",
  reportingPeriod: "Quarterly",
  importantFilters: "Region",
};

const snapshot = { dashboard: { ...dashboard } };

describe("dashboard analysis state", () => {
  it("allows initial analysis for a draft", () => {
    expect(canStartDashboardAnalysis("DRAFT", dashboard, null)).toBe(true);
  });

  it("does not re-analyze an unchanged generated dashboard", () => {
    expect(canStartDashboardAnalysis("GENERATED", dashboard, snapshot)).toBe(
      false,
    );
  });

  it("allows re-analysis after objective context changes", () => {
    const updated = {
      ...dashboard,
      businessObjective: "Monitor revenue and identify margin risks",
    };
    expect(dashboardObjectiveChangedSinceAnalysis(updated, snapshot)).toBe(
      true,
    );
    expect(canStartDashboardAnalysis("GENERATED", updated, snapshot)).toBe(
      true,
    );
  });

  it("does not allow re-analysis without a trustworthy completed snapshot", () => {
    expect(canStartDashboardAnalysis("GENERATED", dashboard, null)).toBe(false);
  });
});
