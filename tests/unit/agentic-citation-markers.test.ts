import { describe, expect, it } from "vitest";
import {
  markeredKnowledge,
  retrievalTraceRows,
} from "@/server/services/agentic-chat-service";
import type { GroundingEvidence } from "@/server/ai/agent/types";

function evidence(
  chunkId: string | undefined,
  content: string,
  overrides: Partial<GroundingEvidence> = {},
): GroundingEvidence {
  return {
    chunkId,
    content,
    contentHash: `hash-${content}`,
    metadata: { sourceType: "KNOWLEDGE_SOURCE" },
    documentId: "doc-1",
    sourceId: "src-1",
    documentName: "Fixed IP.pdf",
    mimeType: "application/pdf",
    vectorScore: 0.5,
    keywordScore: 0.5,
    score: 0.9,
    ...overrides,
  };
}

describe("agentic citation markers", () => {
  it("keeps the marker number the model was shown", () => {
    const rows = markeredKnowledge([
      evidence("c1", "หนึ่ง"),
      evidence("c2", "สอง"),
      evidence("c3", "สาม"),
    ]);

    expect(rows.map((row) => row.marker)).toEqual([1, 2, 3]);
    expect(rows.map((row) => row.item.chunkId)).toEqual(["c1", "c2", "c3"]);
  });

  it("collapses a chunk retrieved by several tool calls onto its first marker", () => {
    // The turn that exposed this crashed on MessageCitation's
    // @@unique([messageId, chunkId]) when one chunk came back from five calls.
    const rows = markeredKnowledge([
      evidence("c1", "หนึ่ง"),
      evidence("c2", "สอง"),
      evidence("c1", "หนึ่งอีกครั้ง"),
      evidence("c3", "สาม"),
      evidence("c2", "สองอีกครั้ง"),
    ]);

    expect(rows.map((row) => row.item.chunkId)).toEqual(["c1", "c2", "c3"]);
    // Gaps are expected: markers 3 and 5 were repeats the model already had.
    expect(rows.map((row) => row.marker)).toEqual([1, 2, 4]);
    expect(new Set(rows.map((row) => row.item.chunkId)).size).toBe(rows.length);
  });

  it("drops evidence with no chunk, which cannot be a knowledge citation", () => {
    const rows = markeredKnowledge([
      evidence(undefined, "ผลจาก API"),
      evidence("c1", "จากเอกสาร"),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ marker: 2, item: { chunkId: "c1" } });
  });

  it("records one retrieval trace per distinct chunk", () => {
    const rows = retrievalTraceRows([
      evidence("c1", "หนึ่ง"),
      evidence("c1", "หนึ่งซ้ำ"),
      evidence("c2", "สอง"),
    ]);

    expect(rows.map((row) => row.chunkId)).toEqual(["c1", "c2"]);
    expect(rows.map((row) => row.rank)).toEqual([1, 3]);
  });

  it("separates chunkless results by their own content instead of merging them", () => {
    const rows = retrievalTraceRows([
      evidence(undefined, "ผล API หนึ่ง", { contentHash: "a" }),
      evidence(undefined, "ผล API สอง", { contentHash: "b" }),
      evidence(undefined, "ผล API หนึ่ง", { contentHash: "a" }),
    ]);

    expect(rows).toHaveLength(2);
  });
});
