export function isTrustedMutationRequest(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase()))
    return true;
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  const origin = request.headers.get("origin");
  // Non-browser service clients do not always send Origin. Browser mutation
  // requests do, and are rejected below when they target a different host.
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const forwardedHost = request.headers.get("x-forwarded-host");
    const host = forwardedHost ?? request.headers.get("host");
    if (!host || originUrl.host.toLowerCase() !== host.toLowerCase())
      return false;
    const forwardedProtocol = request.headers.get("x-forwarded-proto");
    return !forwardedProtocol || `${forwardedProtocol}:` === originUrl.protocol;
  } catch {
    return false;
  }
}

export function contentLengthWithinLimit(
  request: Request,
  maximumBytes: number,
) {
  const value = request.headers.get("content-length");
  if (!value) return true;
  const length = Number(value);
  return Number.isSafeInteger(length) && length >= 0 && length <= maximumBytes;
}
