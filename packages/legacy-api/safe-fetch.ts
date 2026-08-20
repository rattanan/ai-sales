import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import {
  pinnedAddressLookup,
  validatePublicWebUrl,
} from "@/packages/knowledge/source-security";

export type SafeApiErrorCode =
  | "URL_DENIED"
  | "PRIVATE_ADDRESS_DENIED"
  | "HEADER_DENIED"
  | "REDIRECT_DENIED"
  | "CONTENT_TYPE_DENIED"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "FETCH_FAILED";

export class SafeApiError extends Error {
  constructor(
    public readonly code: SafeApiErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const forbiddenHeaders = new Set([
  "host",
  "connection",
  "content-length",
  "transfer-encoding",
  "upgrade",
  "proxy-authorization",
  "proxy-authenticate",
  "cookie",
  "set-cookie",
  "forwarded",
  "x-forwarded-for",
  "x-forwarded-host",
  "x-forwarded-proto",
]);

export function validateOutboundHeaders(headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    if (
      !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
      forbiddenHeaders.has(name.toLowerCase()) ||
      /[\r\n]/.test(value)
    )
      throw new SafeApiError(
        "HEADER_DENIED",
        "A configured request header is not allowed.",
      );
  }
  return headers;
}

type PinnedResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bytes: Buffer;
};

export type SafeApiRequestDependencies = {
  validateUrl?: typeof validatePublicWebUrl;
  requestOnce?: (input: {
    url: URL;
    address: string;
    family: number;
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: Buffer;
    timeoutMs: number;
    maxBytes: number;
  }) => Promise<PinnedResponse>;
};

async function pinnedRequest(input: {
  url: URL;
  address: string;
  family: number;
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs: number;
  maxBytes: number;
}) {
  return new Promise<PinnedResponse>((resolve, reject) => {
    const request = (
      input.url.protocol === "https:" ? httpsRequest : httpRequest
    )(
      input.url,
      {
        method: input.method,
        headers: {
          ...input.headers,
          accept: "application/json",
          "accept-encoding": "identity",
          "user-agent": "InsightKM-LegacyApi/1.0",
          ...(input.body ? { "content-type": "application/json" } : {}),
        },
        lookup: pinnedAddressLookup(input.address, input.family),
        servername: input.url.hostname,
      },
      (response) => {
        const declaredLength = Number(response.headers["content-length"] ?? 0);
        if (declaredLength > input.maxBytes) {
          response.destroy(
            new SafeApiError(
              "RESPONSE_TOO_LARGE",
              "The API response exceeded the configured size limit.",
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxBytes) {
            response.destroy(
              new SafeApiError(
                "RESPONSE_TOO_LARGE",
                "The API response exceeded the configured size limit.",
              ),
            );
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        response.on("end", () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            bytes: Buffer.concat(chunks),
          }),
        );
        response.on("error", reject);
      },
    );
    request.setTimeout(input.timeoutMs, () =>
      request.destroy(
        new SafeApiError("FETCH_FAILED", "The API request timed out."),
      ),
    );
    request.on("error", reject);
    if (input.body) request.write(input.body);
    request.end();
  });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function fetchPublicJsonApi(
  input: {
    url: string;
    allowedDomains: string[];
    method: "GET" | "POST";
    headers: Record<string, string>;
    body?: unknown;
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
  },
  dependencies: SafeApiRequestDependencies = {},
) {
  const validateUrl = dependencies.validateUrl ?? validatePublicWebUrl;
  const requestOnce = dependencies.requestOnce ?? pinnedRequest;
  const headers = validateOutboundHeaders(input.headers);
  const body =
    input.body == null ? undefined : Buffer.from(JSON.stringify(input.body));
  if (body && body.length > 65_536)
    throw new SafeApiError(
      "RESPONSE_TOO_LARGE",
      "The configured API request body is too large.",
    );
  const originalOrigin = new URL(input.url).origin;
  let current = input.url;
  const deadline = Date.now() + input.timeoutMs;
  for (let redirect = 0; redirect <= input.maxRedirects; redirect += 1) {
    let validated: Awaited<ReturnType<typeof validatePublicWebUrl>>;
    try {
      validated = await validateUrl(current, input.allowedDomains);
    } catch (error) {
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "URL_DENIED";
      throw new SafeApiError(
        code === "PRIVATE_ADDRESS_DENIED"
          ? "PRIVATE_ADDRESS_DENIED"
          : "URL_DENIED",
        "The API target failed the public-address policy.",
      );
    }
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new SafeApiError("FETCH_FAILED", "The API request timed out.");
    const response = await requestOnce({
      ...validated,
      method: input.method,
      headers,
      body,
      timeoutMs: remaining,
      maxBytes: input.maxBytes,
    });
    if (response.bytes.length > input.maxBytes)
      throw new SafeApiError(
        "RESPONSE_TOO_LARGE",
        "The API response exceeded the configured size limit.",
      );
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = headerValue(response.headers.location);
      if (!location || redirect === input.maxRedirects)
        throw new SafeApiError(
          "REDIRECT_DENIED",
          "The API redirect limit was exceeded.",
        );
      const candidate = new URL(location, validated.url);
      if (candidate.origin !== originalOrigin)
        throw new SafeApiError(
          "REDIRECT_DENIED",
          "Cross-origin API redirects are not allowed.",
        );
      current = candidate.href;
      continue;
    }
    if (response.status === 401)
      throw new SafeApiError(
        "FETCH_FAILED",
        "The API rejected the credential (HTTP 401). Check that the API key is correct and active, then try again.",
      );
    if (response.status < 200 || response.status >= 300)
      throw new SafeApiError(
        "FETCH_FAILED",
        `The API returned HTTP ${response.status}.`,
      );
    const encoding = headerValue(response.headers["content-encoding"]);
    if (encoding && encoding.toLowerCase() !== "identity")
      throw new SafeApiError(
        "CONTENT_TYPE_DENIED",
        "Compressed API responses are not accepted.",
      );
    const contentType =
      headerValue(response.headers["content-type"])
        ?.split(";")[0]
        .trim()
        .toLowerCase() ?? "";
    if (
      contentType !== "application/json" &&
      contentType !== "text/json" &&
      !contentType.endsWith("+json")
    )
      throw new SafeApiError(
        "CONTENT_TYPE_DENIED",
        "The API response must be JSON.",
      );
    try {
      return {
        payload: JSON.parse(response.bytes.toString("utf8")) as unknown,
        status: response.status,
        finalUrl: validated.url.href,
        contentType,
        bytes: response.bytes.length,
      };
    } catch {
      throw new SafeApiError(
        "INVALID_JSON",
        "The API response was not valid JSON.",
      );
    }
  }
  throw new SafeApiError("REDIRECT_DENIED", "The API redirect was denied.");
}
