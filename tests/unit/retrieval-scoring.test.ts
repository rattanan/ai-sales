import { describe, expect, it } from "vitest";
import { scoreRetrievedChunk } from "@/server/services/retrieval-service";

const THAI_QUERY = "ค่าติดตั้งบรอดแบนด์";
const THAI_CHUNK = "ยกเว้นค่าติดตั้ง (มูลค่า 5,770 บาท) สำหรับบริการบรอดแบนด์";

describe("scoreRetrievedChunk", () => {
  it("admits a chunk that only the trigram signal found", () => {
    // 0.393 is what "แพ็กเกจ Fixed IP ราคาเท่าไร" actually scored against the indexed
    // corpus. It lands in the band where the blended score alone is not enough,
    // so the trigram clause is the only thing keeping the chunk — and the
    // keyword path scores Thai at zero, because `to_tsvector('simple', …)`
    // splits on whitespace that Thai does not write between words.
    const scored = scoreRetrievedChunk("broadband install fee", "unrelated", {
      vectorScore: 0,
      keywordScore: 0,
      trigramScore: 0.393,
    });

    expect(scored.score).toBeLessThan(0.08);
    expect(scored.admitted).toBe(true);
  });

  it("admits a strong trigram match on the blended score by itself", () => {
    const scored = scoreRetrievedChunk(THAI_QUERY, THAI_CHUNK, {
      vectorScore: 0,
      keywordScore: 0,
      trigramScore: 0.53,
    });

    expect(scored.admitted).toBe(true);
  });

  it("rejects a chunk below the measured floor", () => {
    // An off-topic query peaked at 0.20 against the same corpus.
    const scored = scoreRetrievedChunk("broadband install fee", "unrelated", {
      vectorScore: 0,
      keywordScore: 0,
      trigramScore: 0.2,
    });

    expect(scored.admitted).toBe(false);
  });

  it("leaves the vector ranking it had before the trigram signal existed", () => {
    const row = { vectorScore: 0.8, keywordScore: 0.4, trigramScore: 0.35 };
    const withTrigram = scoreRetrievedChunk(
      "fixed ip",
      "Fixed IP package",
      row,
    );
    const withoutTrigram = scoreRetrievedChunk("fixed ip", "Fixed IP package", {
      ...row,
      trigramScore: undefined,
    });

    // Both query words appear, so `lexicalOverlap` reports 1 and the stronger
    // of the two signals is unchanged.
    expect(withTrigram.score).toBe(withoutTrigram.score);
    expect(withTrigram.score).toBeCloseTo(0.8 * 0.65 + 0.4 * 0.15 + 0.2, 10);
  });

  it("uses the trigram score when it beats the word overlap", () => {
    const partialOverlap = scoreRetrievedChunk("fixed ip", "Fixed pricing", {
      vectorScore: 0,
      keywordScore: 0,
      trigramScore: 0.9,
    });

    // One of two words matched, so overlap is 0.5; the trigram signal is higher
    // and takes the lexical slot.
    expect(partialOverlap.score).toBeCloseTo(0.9 * 0.2, 10);
  });

  it("survives a null or non-numeric score from the driver", () => {
    const scored = scoreRetrievedChunk("x", "y", {
      vectorScore: Number.NaN,
      keywordScore: Number.NaN,
      trigramScore: Number.NaN,
    });

    expect(scored.score).toBe(0);
    expect(scored.trigramScore).toBe(0);
    expect(scored.admitted).toBe(false);
  });
});
