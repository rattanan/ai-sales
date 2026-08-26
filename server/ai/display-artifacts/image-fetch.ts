import { request as httpsRequest } from "node:https";
import {
  pinnedAddressLookup,
  validatePublicWebUrl,
} from "@/packages/knowledge/source-security";
import { detectBotImageType } from "@/server/services/bot-assets";

const MAX_IMAGE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 2;
const IMAGE_TIMEOUT_MS = 8_000;

export class DisplayImageError extends Error {
  constructor(
    readonly code:
      | "URL_DENIED"
      | "PRIVATE_ADDRESS_DENIED"
      | "REDIRECT_DENIED"
      | "CONTENT_TYPE_DENIED"
      | "RESPONSE_TOO_LARGE"
      | "FETCH_FAILED",
    message: string,
  ) {
    super(message);
  }
}

type ImageResponse = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  bytes: Buffer;
};

export type DisplayImageDependencies = {
  validateUrl?: typeof validatePublicWebUrl;
  requestOnce?: (input: {
    url: URL;
    address: string;
    family: number;
    timeoutMs: number;
    maxBytes: number;
  }) => Promise<ImageResponse>;
};

function header(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: number) {
  const remaining = deadline - Date.now();
  if (remaining <= 0)
    throw new DisplayImageError("FETCH_FAILED", "The image request timed out.");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new DisplayImageError(
                "FETCH_FAILED",
                "The image request timed out.",
              ),
            ),
          remaining,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function pinnedImageRequest(input: {
  url: URL;
  address: string;
  family: number;
  timeoutMs: number;
  maxBytes: number;
}) {
  return new Promise<ImageResponse>((resolve, reject) => {
    const request = httpsRequest(
      input.url,
      {
        method: "GET",
        headers: {
          accept: "image/avif,image/webp,image/png,image/jpeg;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "InsightKM-DisplayImage/1.0",
        },
        lookup: pinnedAddressLookup(input.address, input.family),
        servername: input.url.hostname,
      },
      (response) => {
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > input.maxBytes) {
          response.destroy(
            new DisplayImageError(
              "RESPONSE_TOO_LARGE",
              "The image exceeds the allowed size.",
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
              new DisplayImageError(
                "RESPONSE_TOO_LARGE",
                "The image exceeds the allowed size.",
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
        new DisplayImageError("FETCH_FAILED", "The image request timed out."),
      ),
    );
    request.on("error", reject);
    request.end();
  });
}

/**
 * Fetches public image bytes through a DNS-pinned request. The original URL is
 * deliberately not returned, so signed query strings cannot enter storage or
 * a browser response.
 */
export async function fetchDisplayImage(
  rawUrl: string,
  dependencies: DisplayImageDependencies = {},
) {
  let original: URL;
  try {
    original = new URL(rawUrl);
  } catch {
    throw new DisplayImageError("URL_DENIED", "The image URL is invalid.");
  }
  if (original.protocol !== "https:" || original.username || original.password)
    throw new DisplayImageError(
      "URL_DENIED",
      "Only credential-free HTTPS image URLs are allowed.",
    );
  original.hash = "";

  const validateUrl = dependencies.validateUrl ?? validatePublicWebUrl;
  const requestOnce = dependencies.requestOnce ?? pinnedImageRequest;
  const allowedDomains = [original.hostname];
  const originalOrigin = original.origin;
  const deadline = Date.now() + IMAGE_TIMEOUT_MS;
  let current = original.href;

  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    let target: Awaited<ReturnType<typeof validatePublicWebUrl>>;
    try {
      target = await beforeDeadline(
        validateUrl(current, allowedDomains),
        deadline,
      );
    } catch (error) {
      if (error instanceof DisplayImageError) throw error;
      const code =
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "URL_DENIED";
      throw new DisplayImageError(
        code === "PRIVATE_ADDRESS_DENIED"
          ? "PRIVATE_ADDRESS_DENIED"
          : "URL_DENIED",
        "The image target failed the public-address policy.",
      );
    }
    if (target.url.protocol !== "https:")
      throw new DisplayImageError(
        "URL_DENIED",
        "Image redirects must remain on HTTPS.",
      );
    const remaining = deadline - Date.now();
    if (remaining <= 0)
      throw new DisplayImageError(
        "FETCH_FAILED",
        "The image request timed out.",
      );
    let response: ImageResponse;
    try {
      response = await requestOnce({
        ...target,
        timeoutMs: remaining,
        maxBytes: MAX_IMAGE_BYTES,
      });
    } catch (error) {
      if (error instanceof DisplayImageError) throw error;
      throw new DisplayImageError(
        "FETCH_FAILED",
        "The image could not be downloaded.",
      );
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = header(response.headers.location);
      if (!location || redirect === MAX_REDIRECTS)
        throw new DisplayImageError(
          "REDIRECT_DENIED",
          "The image redirect limit was exceeded.",
        );
      const candidate = new URL(location, target.url);
      if (candidate.origin !== originalOrigin)
        throw new DisplayImageError(
          "REDIRECT_DENIED",
          "Cross-origin image redirects are not allowed.",
        );
      current = candidate.href;
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw new DisplayImageError(
        "FETCH_FAILED",
        `The image server returned HTTP ${response.status}.`,
      );
    const contentEncoding = header(response.headers["content-encoding"]);
    if (contentEncoding && contentEncoding.toLowerCase() !== "identity")
      throw new DisplayImageError(
        "CONTENT_TYPE_DENIED",
        "Compressed image responses are not accepted.",
      );
    if (response.bytes.length < 1 || response.bytes.length > MAX_IMAGE_BYTES)
      throw new DisplayImageError(
        "RESPONSE_TOO_LARGE",
        "The image size is outside the allowed range.",
      );
    const detected = detectBotImageType(response.bytes);
    if (!detected)
      throw new DisplayImageError(
        "CONTENT_TYPE_DENIED",
        "Only JPEG, PNG and WebP images are supported.",
      );
    const declared =
      header(response.headers["content-type"])
        ?.split(";")[0]
        .trim()
        .toLowerCase() ?? "";
    if (declared && declared !== detected.mimeType)
      throw new DisplayImageError(
        "CONTENT_TYPE_DENIED",
        "The image content type does not match its bytes.",
      );
    return {
      bytes: new Uint8Array(response.bytes),
      mediaType: detected.mimeType,
    };
  }
  throw new DisplayImageError(
    "REDIRECT_DENIED",
    "The image redirect was denied.",
  );
}
