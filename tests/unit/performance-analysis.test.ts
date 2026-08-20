import { describe, expect, it } from "vitest";
import {
  aggregateBotPerformance,
  aggregateSourcePerformance,
  humanizeSourceName,
  type PerformanceEvidenceMessage,
} from "@/packages/insights/performance-analysis";

const messages: PerformanceEvidenceMessage[] = [
  {
    id: "1",
    botName: "Support bot",
    latencyMs: 100,
    errorCode: null,
    feedbackRating: 1,
    citations: [
      { metadata: { documentName: "Operations guide" } },
      { metadata: { documentName: "Operations guide" } },
    ],
  },
  {
    id: "2",
    botName: "Support bot",
    latencyMs: 300,
    errorCode: "NO_GROUNDED_CONTEXT",
    feedbackRating: -1,
    citations: [{ metadata: { documentName: "Operations guide" } }],
  },
  {
    id: "3",
    botName: "HR bot",
    latencyMs: 50,
    errorCode: null,
    feedbackRating: null,
    citations: [
      {
        metadata: { sourceType: "DATABASE", connectionName: "HR database" },
      },
    ],
  },
];

describe("snapshot evidence performance aggregation", () => {
  it("turns encoded ingestion filenames into readable source labels", () => {
    expect(
      humanizeSourceName(
        "law--E0-B8-9B-E0-B8-A3-E0-B8-B0-E0-B8-A1-E0-B8-A7-E0-B8-A5-E0-B8-81-E0-B8-8E-E0-B8-AB-E0-B8-A1-E0-B8-B2-E0-B8-A2-c33e1052a0.html",
      ),
    ).toBe("Law · ประมวลกฎหมาย");
    expect(humanizeSourceName("www.matralaw.com-20b65122a6.html")).toBe(
      "www.matralaw.com",
    );
    expect(
      humanizeSourceName(
        "law--E0-B8-9B-E0-B8-A3-E0-B8-B0-E0-B8-A1-E0-B8-A7-E0-B8-A5-E0-B8-81-E0-B8-8E-E0-B8-AB-E0-B8-A1-E0-B8-B2-E0-B8-A2-E0-B9-8-c33e1052a0.html",
      ),
    ).toBe("Law · ประมวลกฎหมาย");
    expect(humanizeSourceName("news-24269674f2.html")).toBe("News source");
  });

  it("calculates bot reliability, feedback, and latency", () => {
    expect(aggregateBotPerformance(messages)).toEqual([
      {
        bot: "Support bot",
        total: 2,
        errors: 1,
        negative: 1,
        successRate: 0.5,
        averageLatencyMs: 200,
      },
      {
        bot: "HR bot",
        total: 1,
        errors: 0,
        negative: 0,
        successRate: 1,
        averageLatencyMs: 50,
      },
    ]);
  });

  it("counts each cited source once per assistant response", () => {
    expect(aggregateSourcePerformance(messages)).toEqual([
      {
        source: "Operations guide",
        citedResponses: 2,
        negative: 1,
        healthyRate: 0.5,
      },
      {
        source: "HR database",
        citedResponses: 1,
        negative: 0,
        healthyRate: 1,
      },
    ]);
  });
});
