import { describe, expect, it } from "vitest";
import { persistableKnowledgeCitations } from "@/server/services/chat-service";

function evidence(overrides: { chunkId?: string; sourceType: string }) {
  return {
    content: "evidence",
    contentHash: "hash",
    metadata: { sourceType: overrides.sourceType },
    documentId: "document",
    sourceId: "source",
    documentName: "Evidence",
    mimeType: "application/json",
    vectorScore: 0,
    keywordScore: 1,
    score: 1,
    ...(overrides.chunkId ? { chunkId: overrides.chunkId } : {}),
  };
}

describe("chat citation persistence", () => {
  it("persists only evidence backed by a knowledge chunk", () => {
    const knowledge = evidence({
      chunkId: "chunk-1",
      sourceType: "KNOWLEDGE_SOURCE",
    });
    const ntop = evidence({ sourceType: "NTOP" });
    const web = evidence({ sourceType: "WEB_SEARCH" });

    expect(persistableKnowledgeCitations([ntop, knowledge, web])).toEqual([
      knowledge,
    ]);
  });
});
