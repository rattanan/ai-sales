const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "can",
  "do",
  "does",
  "description",
  "filter",
  "find",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "please",
  "show",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "you",
  "your",
  "การ",
  "กับ",
  "กรุณา",
  "ค้นหา",
  "คือ",
  "ขอ",
  "ของ",
  "ข้อมูล",
  "จาก",
  "จะ",
  "ช่วย",
  "ด้วย",
  "ต้องการ",
  "ที่",
  "ทั้งหมด",
  "ถือ",
  "ใน",
  "มี",
  "วิธี",
  "สามารถ",
  "หรือ",
  "อยาก",
  "อะไร",
  "เกี่ยวกับ",
  "เกี่ยว",
  "เป็น",
  "แสดง",
  "แบบ",
  "ไม่",
  "ให้",
  "หา",
  "แล้ว",
  "นี้",
  "นั้น",
  "ตาม",
  "จำนวน",
  "จํานวน",
  "รายการ",
  "บ้าง",
  "และ",
  "ได้",
  "ไหม",
]);

type TopicMessage = { id: string; content: string };

function maskPii(value: string) {
  return value
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, " ")
    .replace(/\+?[\d()\s-]{8,20}/g, " ")
    .replace(/\b\d{13,19}\b/g, " ");
}

function segmentedWords(value: string) {
  const normalized = maskPii(value.normalize("NFC").toLocaleLowerCase());
  return typeof Intl.Segmenter === "function"
    ? [
        ...new Intl.Segmenter(["th", "en"], { granularity: "word" }).segment(
          normalized,
        ),
      ]
        .filter((item) => item.isWordLike)
        .map((item) => item.segment)
    : (normalized.match(/[\p{L}\p{M}\p{N}]+/gu) ?? []);
}

function isContentWord(word: string) {
  return word.length >= 2 && !stopWords.has(word) && !/^\d+$/.test(word);
}

function topicLabel(words: string[]) {
  const allThai = words.every((word) =>
    /^[\p{Script=Thai}\p{M}]+$/u.test(word),
  );
  return words.join(allThai ? "" : " ");
}

export function insightWords(value: string) {
  return segmentedWords(value).filter(isContentWord);
}

export function extractInsightTopics(messages: TopicMessage[], limit = 12) {
  const candidates = new Map<
    string,
    { tokens: string[]; messageIds: Set<string> }
  >();

  for (const message of messages) {
    const words = segmentedWords(message.content);
    const messageCandidates: string[][] = [];
    for (const word of words) {
      if (isContentWord(word)) messageCandidates.push([word]);
    }
    for (let index = 0; index < words.length - 1; index += 1) {
      const pair = words.slice(index, index + 2);
      if (pair.every(isContentWord)) messageCandidates.push(pair);
    }

    for (const tokens of messageCandidates) {
      const topic = topicLabel(tokens);
      const current = candidates.get(topic) ?? {
        tokens,
        messageIds: new Set<string>(),
      };
      current.messageIds.add(message.id);
      candidates.set(topic, current);
    }
  }

  const ranked = [...candidates.entries()].map(([topic, detail]) => ({
    topic,
    tokens: detail.tokens,
    count: detail.messageIds.size,
    messageIds: [...detail.messageIds],
  }));
  const repeatedPhrases = ranked.filter(
    (candidate) => candidate.tokens.length === 2 && candidate.count >= 2,
  );

  return ranked
    .filter((candidate) => {
      if (candidate.tokens.length > 1) return candidate.count >= 2;
      if (candidate.count < 2) return false;
      const containingPhraseCount = repeatedPhrases.reduce(
        (highest, phrase) =>
          phrase.tokens.includes(candidate.tokens[0])
            ? Math.max(highest, phrase.count)
            : highest,
        0,
      );
      return containingPhraseCount / candidate.count < 0.6;
    })
    .sort(
      (left, right) =>
        right.count - left.count ||
        right.tokens.length - left.tokens.length ||
        left.topic.localeCompare(right.topic),
    )
    .slice(0, limit)
    .map((candidate) => ({
      topic: candidate.topic,
      count: candidate.count,
      messageIds: candidate.messageIds,
    }));
}
