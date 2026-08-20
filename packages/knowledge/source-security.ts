import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { lookup } from "node:dns/promises";
import path from "node:path";
import { isSupportedDocument } from "./document-types";

export class SourceSecurityError extends Error {
  constructor(
    public readonly code:
      | "PATH_NOT_ALLOWED"
      | "PATH_NOT_DIRECTORY"
      | "SYMLINK_DENIED"
      | "FILE_LIMIT_EXCEEDED"
      | "URL_DENIED"
      | "PRIVATE_ADDRESS_DENIED"
      | "REDIRECT_DENIED"
      | "CONTENT_TYPE_DENIED"
      | "RESPONSE_TOO_LARGE"
      | "FETCH_FAILED",
    message: string = code,
  ) {
    super(message);
  }
}

export function configuredSharedRoots(value: string) {
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

function isWithin(root: string, target: string) {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function validateSharedFolderConfigurationPath(
  requestedPath: string,
  allowedRoots: string[],
) {
  const target = path.resolve(requestedPath);
  const roots = allowedRoots.map((root) => path.resolve(root));
  if (!roots.some((root) => isWithin(root, target)))
    throw new SourceSecurityError(
      "PATH_NOT_ALLOWED",
      "The folder is outside the configured mount allowlist.",
    );
  return target;
}

export async function validateSharedFolderPath(
  requestedPath: string,
  allowedRoots: string[],
) {
  let target: string;
  const canonicalRoots: string[] = [];
  try {
    target = await realpath(path.resolve(requestedPath));
    for (const root of allowedRoots)
      canonicalRoots.push(await realpath(path.resolve(root)));
  } catch {
    throw new SourceSecurityError(
      "PATH_NOT_ALLOWED",
      "The mounted path or allowlisted root does not exist.",
    );
  }
  if (!canonicalRoots.some((root) => isWithin(root, target)))
    throw new SourceSecurityError(
      "PATH_NOT_ALLOWED",
      "The folder is outside the configured mount allowlist.",
    );
  if (!(await stat(target)).isDirectory())
    throw new SourceSecurityError(
      "PATH_NOT_DIRECTORY",
      "The mounted path is not a directory.",
    );
  return target;
}

async function fileChecksum(filePath: string) {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export type SharedFolderSnapshotInput = {
  locator: string;
  absolutePath: string;
  size: number;
  modifiedAt: Date;
  checksum: string;
};

export async function scanSharedFolder(input: {
  rootPath: string;
  allowedRoots: string[];
  includeSubdirectories: boolean;
  maxFiles: number;
  maxFileBytes: number;
  previous?: Map<
    string,
    { size: number | null; modifiedAt: Date | null; checksum: string | null }
  >;
}) {
  const root = await validateSharedFolderPath(
    input.rootPath,
    input.allowedRoots,
  );
  const files: SharedFolderSnapshotInput[] = [];
  async function walk(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const absolutePath = path.join(directory, entry.name);
      const info = await lstat(absolutePath);
      if (info.isSymbolicLink())
        throw new SourceSecurityError(
          "SYMLINK_DENIED",
          `Symbolic links are not allowed: ${entry.name}`,
        );
      if (info.isDirectory()) {
        if (input.includeSubdirectories) await walk(absolutePath);
        continue;
      }
      if (!info.isFile() || !isSupportedDocument(entry.name)) continue;
      if (files.length >= input.maxFiles)
        throw new SourceSecurityError(
          "FILE_LIMIT_EXCEEDED",
          "The shared-folder file limit was exceeded.",
        );
      if (info.size < 1 || info.size > input.maxFileBytes) continue;
      const locator = path
        .relative(root, absolutePath)
        .split(path.sep)
        .join("/");
      const previous = input.previous?.get(locator);
      const unchangedMetadata =
        previous?.checksum &&
        previous.size === info.size &&
        previous.modifiedAt?.getTime() === info.mtime.getTime();
      files.push({
        locator,
        absolutePath,
        size: info.size,
        modifiedAt: info.mtime,
        checksum: unchangedMetadata
          ? previous.checksum!
          : await fileChecksum(absolutePath),
      });
    }
  }
  await walk(root);
  return { root, files };
}

function ipv4Parts(address: string) {
  const parts = address.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? parts
    : null;
}

export function isPublicAddress(address: string) {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:"))
    return isPublicAddress(normalized.slice(7));
  const family = isIP(normalized);
  if (family === 4) {
    const parts = ipv4Parts(normalized)!;
    const [a, b] = parts;
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && parts[2] === 100) ||
      (a === 203 && b === 0 && parts[2] === 113) ||
      a >= 224
    );
  }
  if (family === 6)
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("fec") ||
      normalized.startsWith("fed") ||
      normalized.startsWith("fee") ||
      normalized.startsWith("fef") ||
      normalized.startsWith("ff") ||
      /^2001:0?db8(?::|$)/.test(normalized)
    );
  return false;
}

function normalizedDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^\.+|\.+$/g, "");
}

export function domainAllowed(hostname: string, allowedDomains: string[]) {
  const host = normalizedDomain(hostname);
  return allowedDomains.some((item) => {
    const domain = normalizedDomain(item);
    return Boolean(domain) && (host === domain || host.endsWith(`.${domain}`));
  });
}

export async function validatePublicWebUrl(
  rawUrl: string,
  allowedDomains: string[],
) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SourceSecurityError(
      "URL_DENIED",
      "The web source URL is invalid.",
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new SourceSecurityError(
      "URL_DENIED",
      "Only credential-free HTTP(S) URLs are allowed.",
    );
  url.hash = "";
  if (!domainAllowed(url.hostname, allowedDomains))
    throw new SourceSecurityError(
      "URL_DENIED",
      "The web source domain is not allowlisted.",
    );
  const addresses = await lookup(url.hostname, {
    all: true,
    verbatim: true,
  }).catch(() => []);
  if (
    !addresses.length ||
    addresses.some(({ address }) => !isPublicAddress(address))
  )
    throw new SourceSecurityError(
      "PRIVATE_ADDRESS_DENIED",
      "The hostname resolves to a non-public address.",
    );
  return { url, address: addresses[0].address, family: addresses[0].family };
}

export async function validateWebRedirect(
  currentUrl: string | URL,
  location: string,
  allowedDomains: string[],
) {
  const candidate = new URL(location, currentUrl).href;
  return (await validatePublicWebUrl(candidate, allowedDomains)).url.href;
}

export function pinnedAddressLookup(
  address: string,
  family: number,
): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

export function extractMainHtml(html: string) {
  const withoutNoise = html
    .replace(
      /<(script|style|nav|header|footer|aside|form|svg)\b[^>]*>[\s\S]*?<\/\1>/gi,
      " ",
    )
    .replace(/<!--([\s\S]*?)-->/g, " ");
  const main = withoutNoise.match(
    /<(article|main)\b[^>]*>([\s\S]*?)<\/\1>/i,
  )?.[2];
  return (
    main ??
    withoutNoise.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ??
    withoutNoise
  ).trim();
}

export function extractSameDomainLinks(
  html: string,
  baseUrl: string | URL,
  rootHostname: string,
) {
  const links = new Set<string>();
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:["']([^"']+)["']|([^\s>]+))/gi;
  for (const match of html.matchAll(pattern)) {
    const href = (match[1] ?? match[2] ?? "").trim();
    if (!href || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    try {
      const url = new URL(href, baseUrl);
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.username ||
        url.password ||
        url.hostname.toLowerCase() !== rootHostname.toLowerCase()
      )
        continue;
      url.hash = "";
      links.add(url.href);
    } catch {
      // Ignore malformed links found in otherwise valid pages.
    }
  }
  return [...links];
}

type WebFetchResult =
  | { notModified: true; finalUrl: string; status: 304 }
  | {
      notModified: false;
      finalUrl: string;
      canonicalUrl: string;
      status: number;
      contentType: string;
      bytes: Buffer;
      links: string[];
      etag?: string;
      lastModified?: string;
    };

async function requestOnce(input: {
  url: URL;
  address: string;
  family: number;
  timeoutMs: number;
  maxBytes: number;
  etag?: string | null;
  lastModified?: string | null;
}) {
  return new Promise<{
    status: number;
    headers: Record<string, string | string[] | undefined>;
    bytes: Buffer;
  }>((resolve, reject) => {
    const request = (
      input.url.protocol === "https:" ? httpsRequest : httpRequest
    )(
      input.url,
      {
        method: "GET",
        headers: {
          accept: "text/html,text/plain,text/markdown;q=0.9",
          "accept-encoding": "identity",
          "user-agent": "InsightKM-WebSource/1.0",
          ...(input.etag ? { "if-none-match": input.etag } : {}),
          ...(input.lastModified
            ? { "if-modified-since": input.lastModified }
            : {}),
        },
        lookup: pinnedAddressLookup(input.address, input.family),
        servername: input.url.hostname,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > input.maxBytes) {
            response.destroy(
              new SourceSecurityError(
                "RESPONSE_TOO_LARGE",
                "The web response exceeded the configured size limit.",
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
        new SourceSecurityError("FETCH_FAILED", "The web request timed out."),
      ),
    );
    request.on("error", reject);
    request.end();
  });
}

function headerValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export async function fetchWebPage(input: {
  url: string;
  allowedDomains: string[];
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  etag?: string | null;
  lastModified?: string | null;
}): Promise<WebFetchResult> {
  let current = input.url;
  for (let redirect = 0; redirect <= input.maxRedirects; redirect += 1) {
    const validated = await validatePublicWebUrl(current, input.allowedDomains);
    const response = await requestOnce({
      ...validated,
      timeoutMs: input.timeoutMs,
      maxBytes: input.maxBytes,
      etag: redirect === 0 ? input.etag : null,
      lastModified: redirect === 0 ? input.lastModified : null,
    });
    if (response.status === 304)
      return { notModified: true, finalUrl: validated.url.href, status: 304 };
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = headerValue(response.headers.location);
      if (!location || redirect === input.maxRedirects)
        throw new SourceSecurityError(
          "REDIRECT_DENIED",
          "The web source redirect limit was exceeded.",
        );
      current = await validateWebRedirect(
        validated.url,
        location,
        input.allowedDomains,
      );
      continue;
    }
    if (response.status < 200 || response.status >= 300)
      throw new SourceSecurityError(
        "FETCH_FAILED",
        `The web source returned HTTP ${response.status}.`,
      );
    const contentType =
      headerValue(response.headers["content-type"])
        ?.split(";")[0]
        .trim()
        .toLowerCase() ?? "";
    if (
      !["text/html", "text/plain", "text/markdown", "text/x-markdown"].includes(
        contentType,
      )
    )
      throw new SourceSecurityError(
        "CONTENT_TYPE_DENIED",
        `Unsupported web content type: ${contentType || "missing"}.`,
      );
    const text = response.bytes.toString("utf8");
    const canonicalHref =
      contentType === "text/html"
        ? (text.match(
            /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i,
          )?.[1] ??
          text.match(
            /<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i,
          )?.[1])
        : undefined;
    let canonicalUrl = validated.url.href;
    if (canonicalHref) {
      const candidate = new URL(canonicalHref, validated.url).href;
      canonicalUrl = (
        await validatePublicWebUrl(candidate, input.allowedDomains)
      ).url.href;
    }
    const links =
      contentType === "text/html"
        ? extractSameDomainLinks(
            text,
            validated.url,
            new URL(input.url).hostname,
          )
        : [];
    const content = contentType === "text/html" ? extractMainHtml(text) : text;
    return {
      notModified: false,
      finalUrl: validated.url.href,
      canonicalUrl,
      status: response.status,
      contentType,
      bytes: Buffer.from(content),
      links,
      etag: headerValue(response.headers.etag),
      lastModified: headerValue(response.headers["last-modified"]),
    };
  }
  throw new SourceSecurityError("REDIRECT_DENIED");
}
