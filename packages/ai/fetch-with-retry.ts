export async function fetchAiWithRetry(
  url: string,
  init: Omit<RequestInit, "signal">,
  options: { timeoutMs: number; maxRetries: number },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
    let retryDelayMs: number | undefined;
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(options.timeoutMs),
      });
      const retryable =
        [408, 409, 425, 429].includes(response.status) ||
        response.status >= 500;
      if (response.ok || !retryable || attempt === options.maxRetries)
        return response;
      const retryAfter = response.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const retryAt = Date.parse(retryAfter);
        retryDelayMs = Number.isFinite(seconds)
          ? seconds * 1_000
          : Number.isFinite(retryAt)
            ? retryAt - Date.now()
            : undefined;
      }
      if (response.status === 429 && retryDelayMs === undefined)
        retryDelayMs = 10_000 * 2 ** attempt;
    } catch (error) {
      lastError = error;
      if (attempt === options.maxRetries) {
        const cause =
          error instanceof Error &&
          error.cause &&
          typeof error.cause === "object"
            ? (error.cause as { code?: unknown; message?: unknown })
            : undefined;
        const causeCode =
          typeof cause?.code === "string" ? cause.code : undefined;
        const causeMessage =
          typeof cause?.message === "string" ? cause.message : undefined;
        const detail =
          [causeCode, causeMessage].filter(Boolean).join(": ") ||
          (error instanceof Error ? error.message : "unknown network error");
        throw new Error(`AI endpoint request failed: ${detail}`, {
          cause: error,
        });
      }
    }
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.min(
          60_000,
          Math.max(0, retryDelayMs ?? Math.min(2_000, 250 * 2 ** attempt)),
        ),
      ),
    );
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("AI endpoint request failed");
}
