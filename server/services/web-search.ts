import { env } from "@/schemas/env";

export type WebSearchEvidence = {
  content: string;
  contentHash: string;
  metadata: {
    sourceType: "WEB_SEARCH";
    title: string;
    url: string;
    fetchedAt: string;
  };
  documentId: string;
  sourceId: string;
  documentName: string;
  mimeType: "text/html";
  vectorScore: 0;
  keywordScore: number;
  score: number;
};

type SearchConfiguration = {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxResults: number;
};

function searchEndpoint(baseUrl: string) {
  const trimmed = baseUrl.replace(/\/$/, "");
  return trimmed.endsWith("/search") ? trimmed : `${trimmed}/search`;
}

function safeHttpUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function normalizeWebSearchResults(
  payload: unknown,
): WebSearchEvidence[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const fetchedAt = new Date().toISOString();
  return results.flatMap((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const result = item as Record<string, unknown>;
    const url = safeHttpUrl(result.url);
    const content =
      typeof result.content === "string" ? result.content.trim() : "";
    if (!url || !content) return [];
    const title =
      typeof result.title === "string" && result.title.trim()
        ? result.title.trim().slice(0, 300)
        : new URL(url).hostname;
    const providerScore =
      typeof result.score === "number" && Number.isFinite(result.score)
        ? Math.max(0, Math.min(1, result.score))
        : Math.max(0.1, 1 - index * 0.1);
    return [
      {
        content: content.slice(0, 6_000),
        contentHash: url,
        metadata: {
          sourceType: "WEB_SEARCH" as const,
          title,
          url,
          fetchedAt,
        },
        documentId: url,
        sourceId: url,
        documentName: title,
        mimeType: "text/html" as const,
        vectorScore: 0 as const,
        keywordScore: providerScore,
        score: providerScore,
      },
    ];
  });
}

export async function searchWeb(
  query: string,
  configuration?: SearchConfiguration,
) {
  const settings =
    configuration ??
    (() => {
      const environment = env();
      if (!environment.WEB_SEARCH_API_KEY)
        throw new Error("WEB_SEARCH_NOT_CONFIGURED");
      return {
        apiKey: environment.WEB_SEARCH_API_KEY,
        baseUrl: environment.WEB_SEARCH_BASE_URL,
        timeoutMs: environment.WEB_SEARCH_TIMEOUT_MS,
        maxResults: environment.WEB_SEARCH_MAX_RESULTS,
      };
    })();
  const response = await fetch(searchEndpoint(settings.baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
      max_results: settings.maxResults,
    }),
    signal: AbortSignal.timeout(settings.timeoutMs),
  });
  if (!response.ok) throw new Error(`WEB_SEARCH_HTTP_${response.status}`);
  return normalizeWebSearchResults(await response.json());
}
