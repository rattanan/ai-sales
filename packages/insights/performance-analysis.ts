export type PerformanceEvidenceMessage = {
  id: string;
  botName: string;
  latencyMs: number | null;
  errorCode: string | null;
  feedbackRating: number | null;
  citations: Array<{ metadata: unknown }>;
};

export function humanizeSourceName(value: string) {
  const pathname = value.split(/[?#]/, 1)[0].split("/").filter(Boolean).at(-1);
  const withoutExtension = (pathname ?? value)
    .replace(/\.(?:html?|pdf|docx?|xlsx?)$/i, "")
    .replace(/[-_][a-f\d]{10,64}$/i, "");
  const parts = withoutExtension.split("-");
  const decoded: string[] = [];
  for (let index = 0; index < parts.length;) {
    if (/^[a-f\d]{2}$/i.test(parts[index])) {
      const bytes: number[] = [];
      while (index < parts.length && /^[a-f\d]{2}$/i.test(parts[index])) {
        bytes.push(Number.parseInt(parts[index], 16));
        index += 1;
      }
      const text = new TextDecoder("utf-8")
        .decode(Uint8Array.from(bytes))
        .replaceAll("�", "")
        .trim();
      if (text) decoded.push(text);
      continue;
    }
    if (/^[a-f\d]$/i.test(parts[index])) {
      index += 1;
      continue;
    }
    if (parts[index]) decoded.push(parts[index]);
    index += 1;
  }
  const label = decoded.join(" ").replaceAll("_", " ").trim();
  if (!label) return "Knowledge source";
  const typed = label.match(/^(law|news|judgement)(?:\s+(.+))?$/i);
  if (!typed) return label;
  const type = `${typed[1][0].toUpperCase()}${typed[1].slice(1)}`;
  return typed[2] ? `${type} · ${typed[2]}` : `${type} source`;
}

function sourceLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return "Unknown source";
  const value = metadata as Record<string, unknown>;
  if (value.sourceType === "DATABASE")
    return typeof value.connectionName === "string"
      ? value.connectionName
      : "Database";
  if (value.sourceType === "LEGACY_API")
    return typeof value.apiName === "string" ? value.apiName : "Legacy API";
  return typeof value.documentName === "string"
    ? humanizeSourceName(value.documentName)
    : typeof value.canonicalUrl === "string"
      ? humanizeSourceName(value.canonicalUrl)
      : "Knowledge source";
}

export function aggregateBotPerformance(
  messages: PerformanceEvidenceMessage[],
) {
  const bots = new Map<
    string,
    {
      total: number;
      errors: number;
      negative: number;
      latencyTotal: number;
      latencyCount: number;
    }
  >();
  for (const message of messages) {
    const current = bots.get(message.botName) ?? {
      total: 0,
      errors: 0,
      negative: 0,
      latencyTotal: 0,
      latencyCount: 0,
    };
    current.total += 1;
    if (message.errorCode) current.errors += 1;
    if (message.feedbackRating === -1) current.negative += 1;
    if (message.latencyMs != null) {
      current.latencyTotal += message.latencyMs;
      current.latencyCount += 1;
    }
    bots.set(message.botName, current);
  }
  return [...bots.entries()]
    .map(([bot, values]) => ({
      bot,
      total: values.total,
      errors: values.errors,
      negative: values.negative,
      successRate: values.total
        ? (values.total - values.errors) / values.total
        : 0,
      averageLatencyMs: values.latencyCount
        ? Math.round(values.latencyTotal / values.latencyCount)
        : 0,
    }))
    .sort(
      (left, right) =>
        right.errors + right.negative - (left.errors + left.negative) ||
        right.total - left.total,
    );
}

export function aggregateSourcePerformance(
  messages: PerformanceEvidenceMessage[],
) {
  const sources = new Map<
    string,
    { citedResponses: number; negative: number }
  >();
  for (const message of messages) {
    const labels = new Set(
      message.citations.map(({ metadata }) => sourceLabel(metadata)),
    );
    for (const source of labels) {
      const current = sources.get(source) ?? {
        citedResponses: 0,
        negative: 0,
      };
      current.citedResponses += 1;
      if (message.feedbackRating === -1) current.negative += 1;
      sources.set(source, current);
    }
  }
  return [...sources.entries()]
    .map(([source, values]) => ({
      source,
      ...values,
      healthyRate: values.citedResponses
        ? (values.citedResponses - values.negative) / values.citedResponses
        : 0,
    }))
    .sort(
      (left, right) =>
        right.citedResponses - left.citedResponses ||
        left.source.localeCompare(right.source),
    );
}
