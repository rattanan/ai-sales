function providerMessage(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    return undefined;

  const row = payload as Record<string, unknown>;
  if (typeof row.message === "string") return row.message;
  if (row.error && typeof row.error === "object" && !Array.isArray(row.error)) {
    const error = row.error as Record<string, unknown>;
    if (typeof error.message === "string") return error.message;
  }
  return undefined;
}

function safeProviderMessage(value: string) {
  return value
    .replace(/Bearer\s+\S+/gi, "Bearer [REDACTED]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[REDACTED]")
    .replace(/\s+/g, " ")
    .trim();
}

export async function providerHttpError(response: Response) {
  const prefix = `Endpoint returned HTTP ${response.status}`;
  try {
    const payload = JSON.parse(await response.text()) as unknown;
    const detail = providerMessage(payload);
    if (!detail) return prefix;
    return `${prefix}: ${safeProviderMessage(detail)}`.slice(0, 300);
  } catch {
    return prefix;
  }
}
