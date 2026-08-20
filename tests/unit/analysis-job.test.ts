import { describe, expect, it } from "vitest";
import {
  analysisJobSummary,
  nextAnalysisStage,
  STAGE_PROGRESS,
} from "@/server/services/analysis-job-service";

describe("analysis job orchestration", () => {
  it("advances through the persisted stage sequence", () => {
    expect(nextAnalysisStage("PREPARING_METADATA")).toBe("ANALYZING_SCHEMA");
    expect(nextAnalysisStage("EXECUTING_QUERIES")).toBe("GENERATING_WIDGETS");
    expect(nextAnalysisStage("FINALIZING_DASHBOARD")).toBe(
      "FINALIZING_DASHBOARD",
    );
    expect(STAGE_PROGRESS.GENERATING_INSIGHTS).toBeGreaterThan(
      STAGE_PROGRESS.GENERATING_WIDGETS,
    );
  });

  it("returns a sanitized client status without request snapshots", () => {
    const summary = analysisJobSummary({
      id: "job",
      dashboardId: "dashboard",
      status: "RUNNING",
      currentStage: "ANALYZING_SCHEMA",
      progressPercent: 15,
      errorCode: null,
      errorMessage: null,
      lastHeartbeatAt: new Date("2026-07-18T00:00:01.000Z"),
      updatedAt: new Date("2026-07-18T00:00:00.000Z"),
    });
    expect(summary).toEqual({
      id: "job",
      dashboardId: "dashboard",
      status: "RUNNING",
      currentStage: "ANALYZING_SCHEMA",
      progressPercent: 15,
      errorCode: null,
      errorMessage: null,
      lastHeartbeatAt: "2026-07-18T00:00:01.000Z",
      updatedAt: "2026-07-18T00:00:00.000Z",
    });
    expect(summary).not.toHaveProperty("requestSnapshot");
  });
});
