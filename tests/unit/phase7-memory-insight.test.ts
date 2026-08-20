import { describe, expect, it } from "vitest";
import { businessInsightFilterSchema } from "@/schemas/business-insight";
import { messageFeedbackSchema } from "@/schemas/knowledge";
import { containsProhibitedMemory } from "@/server/services/user-memory-service";
import { shouldSummarizeConversation } from "@/server/services/conversation-memory-service";
import { aggregateBusinessInsight } from "@/server/services/business-insight-service";
import { buildDailyTrends } from "@/packages/insights/process-business-insight";
import {
  extractInsightTopics,
  insightWords,
} from "@/packages/insights/topic-analysis";

function conversation(
  id: string,
  question: string,
  options: { error?: string; gap?: boolean; negative?: boolean } = {},
) {
  const createdAt = new Date(
    `2026-08-${String(Number(id) + 1).padStart(2, "0")}T10:00:00.000Z`,
  );
  return {
    id: `conversation-${id}`,
    botId: "bot-1",
    botName: "Support bot",
    messages: [
      {
        id: `user-${id}`,
        role: "USER" as const,
        content: question,
        createdAt,
        latencyMs: null,
        errorCode: null,
        feedback: null,
        citations: [],
      },
      {
        id: `assistant-${id}`,
        role: "ASSISTANT" as const,
        content: options.gap ? "No grounded context" : "Grounded answer",
        createdAt,
        latencyMs: 100 + Number(id) * 10,
        errorCode: options.error ?? null,
        feedback: options.negative
          ? {
              rating: -1,
              reason: options.gap ? "MISSING_INFORMATION" : "INCORRECT",
            }
          : { rating: 1, reason: "CORRECT" },
        citations: options.gap
          ? []
          : [{ metadata: { documentName: "Support policy" } }],
      },
    ],
  };
}

describe("Phase 7 consented memory", () => {
  it.each([
    ["password", "hunter2"],
    ["preference", "token=abc123456789"],
    ["preference", "Bearer abcdefghijklmnop"],
    ["preference", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature"],
    ["contact", "person@example.com"],
    ["phone", "+66 81 234 5678"],
  ])("rejects prohibited memory %s", (key, value) => {
    expect(containsProhibitedMemory(key, value)).toBe(true);
  });

  it("accepts a bounded non-sensitive preference", () => {
    expect(
      containsProhibitedMemory("response_style", "สรุปภาษาไทยแบบกระชับ"),
    ).toBe(false);
  });
});

describe("Phase 7 conversation summary threshold", () => {
  it("summarizes only after both message and character thresholds are exceeded", () => {
    expect(
      shouldSummarizeConversation(
        Array.from({ length: 8 }, () => ({ content: "x".repeat(600) })),
        4_000,
      ),
    ).toBe(true);
    expect(
      shouldSummarizeConversation(
        Array.from({ length: 7 }, () => ({ content: "x".repeat(700) })),
        4_000,
      ),
    ).toBe(false);
  });
});

describe("Phase 7 business-insight golden aggregation", () => {
  it("segments Thai words without broken vowels or tone marks", () => {
    expect(insightWords("ช่วยค้นหาใบสั่งงานของสินทรัพย์")).toEqual([
      "ใบสั่ง",
      "งาน",
      "สินทรัพย์",
    ]);
  });

  it("removes generic commands and field labels from Thai/English topics", () => {
    expect(
      insightWords("ช่วยหา asset description เกี่ยวกับ filter ได้ไหม"),
    ).toEqual(["asset"]);
  });

  it("prefers repeated topic phrases over less meaningful component words", () => {
    const topics = extractInsightTopics([
      { id: "1", content: "Filter asset description by work order" },
      { id: "2", content: "Filter asset description by work order" },
      { id: "3", content: "Filter asset status by work order" },
      { id: "4", content: "Filter asset status by work order" },
    ]);

    expect(topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: "work order", count: 4 }),
        expect.objectContaining({ topic: "asset", count: 4 }),
        expect.objectContaining({ topic: "asset status", count: 2 }),
      ]),
    );
    expect(topics.map(({ topic }) => topic)).not.toContain("filter");
    expect(topics.map(({ topic }) => topic)).not.toContain("work");
  });

  it("joins adjacent Thai topic words into a readable phrase", () => {
    const topics = extractInsightTopics([
      { id: "1", content: "ค้นหาใบสั่งงานที่ยังไม่อนุมัติ" },
      { id: "2", content: "แสดงใบสั่งงานที่รออนุมัติ" },
    ]);

    expect(topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: "ใบสั่งงาน", count: 2 }),
      ]),
    );
  });

  it("keeps Thai sara am composed for meaningful compound topics", () => {
    const topics = extractInsightTopics([
      { id: "1", content: "จำนวนคำเสนอที่ถือเป็นข้อสนอง" },
      { id: "2", content: "คำเสนอและข้อสนองมีผลเมื่อใด" },
    ]);

    expect(topics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ topic: "คำเสนอ", count: 2 }),
        expect.objectContaining({ topic: "ข้อสนอง", count: 2 }),
      ]),
    );
    expect(topics.map(({ topic }) => topic)).not.toContain("นวน");
  });

  it("builds chronological daily chart data in the queue worker", () => {
    expect(
      buildDailyTrends([
        {
          createdAt: new Date("2026-08-20T03:00:00.000Z"),
          errorCode: null,
          latencyMs: 100,
        },
        {
          createdAt: new Date("2026-08-19T03:00:00.000Z"),
          errorCode: "NO_GROUNDED_CONTEXT",
          latencyMs: 300,
        },
        {
          createdAt: new Date("2026-08-20T04:00:00.000Z"),
          errorCode: "AI_PROVIDER_ERROR",
          latencyMs: 200,
        },
      ]),
    ).toEqual([
      {
        date: "2026-08-19",
        messages: 1,
        errors: 1,
        averageLatencyMs: 300,
      },
      {
        date: "2026-08-20",
        messages: 2,
        errors: 1,
        averageLatencyMs: 150,
      },
    ]);
  });

  it("classifies topics, repeated problems, gaps, errors, latency, and evidence", () => {
    const result = aggregateBusinessInsight([
      conversation("1", "How do I reset payroll access?"),
      conversation("2", "How do I reset payroll access?", {
        gap: true,
        error: "NO_GROUNDED_CONTEXT",
        negative: true,
      }),
      conversation("3", "What is the payroll approval policy?", {
        negative: true,
      }),
    ]);
    expect(result.enoughEvidence).toBe(true);
    expect(result.metrics).toMatchObject({
      conversationCount: 3,
      messageCount: 6,
      errorCount: 1,
      negativeFeedbackCount: 2,
    });
    expect(result.topics.some(({ topic }) => topic.includes("payroll"))).toBe(
      true,
    );
    expect(result.repeatedProblems[0]).toMatchObject({ count: 2 });
    expect(result.knowledgeGaps.count).toBe(1);
    expect(result.findings.map(({ type }) => type)).toEqual(
      expect.arrayContaining([
        "REPEATED_PROBLEM",
        "KNOWLEDGE_GAP",
        "OPPORTUNITY",
        "RISK",
        "LOW_PERFORMING_SOURCE",
        "LOW_PERFORMING_BOT",
        "RECOMMENDATION",
      ]),
    );
    expect(result.evidenceAggregate.conversationIds).toHaveLength(3);
  });

  it("returns exact metrics but no conclusions for an insufficient sample", () => {
    const result = aggregateBusinessInsight([
      conversation("1", "Single question", { error: "AI_PROVIDER_ERROR" }),
    ]);
    expect(result.enoughEvidence).toBe(false);
    expect(result.metrics.messageCount).toBe(2);
    expect(result.findings).toEqual([]);
    expect(result.limitations[0]).toMatch(/Insufficient sample/);
  });
});

describe("Phase 7 input contracts", () => {
  it("bounds insight ranges and validates structured feedback reasons", () => {
    expect(
      businessInsightFilterSchema.safeParse({
        dateFrom: "2026-01-01",
        dateTo: "2027-12-31",
      }).success,
    ).toBe(false);
    expect(
      messageFeedbackSchema.safeParse({
        messageId: "message-1",
        rating: -1,
        reason: "MISSING_INFORMATION",
        comment: "The policy date was missing.",
      }).success,
    ).toBe(true);
  });
});
