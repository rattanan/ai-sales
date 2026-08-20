import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";
import type { WorkerEnvironment } from "../../schemas/worker-env.js";
import {
  configuredSharedRoots,
  fetchWebPage,
  scanSharedFolder,
  SourceSecurityError,
} from "./source-security.js";
import {
  downloadGoogleDriveFile,
  googleDriveAccessToken,
  scanGoogleDriveFolder,
} from "./google-drive.js";
import { isGoogleDriveFolderUrl } from "./google-drive-url.js";

type SourceRow = {
  sourceId: string;
  sourceName: string;
  sourceType: "SHARED_FOLDER" | "WEB";
  organizationId: string;
  createdById: string;
  rootPath: string | null;
  includeSubdirectories: boolean | null;
  maxFiles: number | null;
  url: string | null;
  allowedDomains: string[] | null;
  timeoutMs: number | null;
  maxBytes: number | null;
  maxRedirects: number | null;
  crawlDepth: number | null;
  maxPages: number | null;
  embeddingModel: string | null;
};

type SnapshotRow = {
  id: string;
  locator: string;
  size: number | null;
  modifiedAt: Date | null;
  checksum: string | null;
  etag: string | null;
  lastModified: string | null;
  documentId: string | null;
  metadata: Record<string, unknown> | null;
};

function mimeFor(fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  return (
    {
      pdf: "application/pdf",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      csv: "text/csv",
      txt: "text/plain",
      md: "text/markdown",
      markdown: "text/markdown",
      html: "text/html",
      htm: "text/html",
    }[extension ?? ""] ?? "application/octet-stream"
  );
}

async function storeBytes(root: string, bytes: Buffer) {
  await mkdir(path.resolve(root), { recursive: true });
  const key = randomUUID();
  await writeFile(path.join(path.resolve(root), key), bytes, {
    flag: "wx",
    mode: 0o600,
  });
  return key;
}

async function sourceRow(pool: Pool, sourceId: string) {
  const { rows } = await pool.query<SourceRow>(
    `SELECT s.id AS "sourceId", s.name AS "sourceName", s.type AS "sourceType",
            r."organizationId", r."createdById",
            f."rootPath", f."includeSubdirectories", f."maxFiles",
            w.url, w."allowedDomains", w."timeoutMs", w."maxBytes", w."maxRedirects",
            w."crawlDepth", w."maxPages",
            COALESCE(ep.model, p."embeddingModel") AS "embeddingModel"
       FROM "KnowledgeSource" s
       JOIN "KnowledgeRack" r ON r.id = s."rackId"
       LEFT JOIN "SharedFolderSourceConfig" f ON f."sourceId" = s.id
       LEFT JOIN "WebSourceConfig" w ON w."sourceId" = s.id
       LEFT JOIN LATERAL (
         SELECT model FROM "AiEndpointConfig"
          WHERE "organizationId" = r."organizationId"
            AND kind = 'EMBEDDING' AND active = true
          ORDER BY "updatedAt" DESC LIMIT 1
       ) ep ON true
       LEFT JOIN LATERAL (
         SELECT "embeddingModel" FROM "LlmProvider"
          WHERE "organizationId" = r."organizationId" AND active = true
          ORDER BY "updatedAt" DESC LIMIT 1
       ) p ON true
      WHERE s.id = $1 AND s.active = true`,
    [sourceId],
  );
  return rows[0];
}

export function shouldSkipWebCrawlError(error: unknown, depth: number) {
  if (depth === 0 || !(error instanceof SourceSecurityError)) return false;
  if (error.code !== "FETCH_FAILED") return false;
  return /^The web source returned HTTP (?:400|403)\.$/.test(error.message);
}

async function ensureRun(
  pool: Pool,
  sourceId: string,
  runId: string | undefined,
  trigger: "MANUAL" | "SCHEDULED",
) {
  if (runId) return runId;
  const active = await pool.query<{ id: string }>(
    `SELECT id FROM "SourceRefreshRun"
      WHERE "sourceId" = $1 AND status IN ('QUEUED', 'PROCESSING')
      ORDER BY "createdAt" DESC LIMIT 1`,
    [sourceId],
  );
  if (active.rows[0]) return active.rows[0].id;
  const id = randomUUID();
  await pool.query(
    `INSERT INTO "SourceRefreshRun"
       (id, "sourceId", trigger, status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'QUEUED', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [id, sourceId, trigger],
  );
  return id;
}

async function createVersion(
  client: PoolClient,
  input: {
    source: SourceRow;
    runId: string;
    locator: string;
    name: string;
    mimeType: string;
    checksum: string;
    bytes: Buffer;
    sourceMetadata: Record<string, unknown>;
    storageRoot: string;
  },
) {
  const existing = await client.query<{
    id: string;
    checksum: string;
    latestVersion: number | null;
  }>(
    `SELECT d.id, d.checksum,
            (SELECT MAX(v.version) FROM "DocumentVersion" v WHERE v."documentId" = d.id) AS "latestVersion"
       FROM "Document" d
      WHERE d."sourceId" = $1 AND d."sourceLocator" = $2
      FOR UPDATE`,
    [input.source.sourceId, input.locator],
  );
  const current = existing.rows[0];
  if (current?.checksum === input.checksum) {
    await client.query(
      `UPDATE "Document" SET active = true, "sourceDeletedAt" = NULL,
              "sourceMetadata" = $2::jsonb, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [current.id, JSON.stringify(input.sourceMetadata)],
    );
    return { documentId: current.id, indexJobId: null, changed: false };
  }
  const storageKey = await storeBytes(input.storageRoot, input.bytes);
  const documentId = current?.id ?? randomUUID();
  if (current) {
    await client.query(
      `UPDATE "Document"
          SET name = $2, "mimeType" = $3, checksum = $4, active = true,
              "sourceDeletedAt" = NULL, "sourceMetadata" = $5::jsonb,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        documentId,
        input.name,
        input.mimeType,
        input.checksum,
        JSON.stringify(input.sourceMetadata),
      ],
    );
  } else {
    await client.query(
      `INSERT INTO "Document"
         (id, "organizationId", "sourceId", name, "mimeType", checksum,
          "sourceLocator", "sourceMetadata", active, "createdById", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, true, $9,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [
        documentId,
        input.source.organizationId,
        input.source.sourceId,
        input.name,
        input.mimeType,
        input.checksum,
        input.locator,
        JSON.stringify(input.sourceMetadata),
        input.source.createdById,
      ],
    );
  }
  const versionId = randomUUID();
  await client.query(
    `INSERT INTO "DocumentVersion"
       (id, "documentId", version, "storageKey", size, checksum, "mimeType",
        status, "uploadedById", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'QUEUED', $8,
             CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      versionId,
      documentId,
      (current?.latestVersion ?? 0) + 1,
      storageKey,
      input.bytes.length,
      input.checksum,
      input.mimeType,
      input.source.createdById,
    ],
  );
  const indexJobId = randomUUID();
  await client.query(
    `INSERT INTO "DocumentIndexJob"
       (id, "documentVersionId", "sourceRefreshRunId", status, "embeddingModel",
        "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'QUEUED', $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      indexJobId,
      versionId,
      input.runId,
      input.source.embeddingModel ??
        process.env.EMBEDDING_MODEL ??
        "qwen3-embedding:4b",
    ],
  );
  return { documentId, indexJobId, changed: true };
}

async function snapshots(pool: Pool, sourceId: string) {
  const { rows } = await pool.query<SnapshotRow>(
    `SELECT id, locator, size, "modifiedAt", checksum, etag, "lastModified", "documentId", metadata
       FROM "SourceSnapshot" WHERE "sourceId" = $1`,
    [sourceId],
  );
  return new Map(rows.map((row) => [row.locator, row]));
}

async function upsertSnapshot(
  client: PoolClient,
  input: {
    sourceId: string;
    runId: string;
    locator: string;
    documentId?: string | null;
    size?: number | null;
    modifiedAt?: Date | null;
    checksum?: string | null;
    etag?: string | null;
    lastModified?: string | null;
    fetchedAt?: Date | null;
    httpStatus?: number | null;
    canonicalUrl?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await client.query(
    `INSERT INTO "SourceSnapshot"
       (id, "sourceId", locator, status, size, "modifiedAt", checksum, etag,
        "lastModified", "fetchedAt", "httpStatus", "canonicalUrl", metadata,
        "documentId", "lastSeenRunId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, 'ACTIVE', $4, $5, $6, $7, $8, $9, $10, $11,
             $12::jsonb, $13, $14, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT ("sourceId", locator) DO UPDATE SET
       status = 'ACTIVE', size = EXCLUDED.size, "modifiedAt" = EXCLUDED."modifiedAt",
       checksum = EXCLUDED.checksum, etag = EXCLUDED.etag,
       "lastModified" = EXCLUDED."lastModified", "fetchedAt" = EXCLUDED."fetchedAt",
       "httpStatus" = EXCLUDED."httpStatus", "canonicalUrl" = EXCLUDED."canonicalUrl",
       metadata = EXCLUDED.metadata, "documentId" = EXCLUDED."documentId",
       "lastSeenRunId" = EXCLUDED."lastSeenRunId", "updatedAt" = CURRENT_TIMESTAMP`,
    [
      randomUUID(),
      input.sourceId,
      input.locator,
      input.size ?? null,
      input.modifiedAt ?? null,
      input.checksum ?? null,
      input.etag ?? null,
      input.lastModified ?? null,
      input.fetchedAt ?? null,
      input.httpStatus ?? null,
      input.canonicalUrl ?? null,
      JSON.stringify(input.metadata ?? {}),
      input.documentId ?? null,
      input.runId,
    ],
  );
}

async function refreshFolder(
  pool: Pool,
  source: SourceRow,
  runId: string,
  environment: WorkerEnvironment,
  enqueueIndex: (indexJobId: string) => Promise<void>,
) {
  if (!source.rootPath)
    throw new Error("Shared folder configuration is missing");
  const previous = await snapshots(pool, source.sourceId);
  const scan = await scanSharedFolder({
    rootPath: source.rootPath,
    allowedRoots: configuredSharedRoots(
      environment.KNOWLEDGE_SHARED_FOLDER_ROOTS,
    ),
    includeSubdirectories: source.includeSubdirectories ?? true,
    maxFiles: Math.min(
      source.maxFiles ?? environment.KNOWLEDGE_SHARED_FOLDER_MAX_FILES,
      environment.KNOWLEDGE_SHARED_FOLDER_MAX_FILES,
    ),
    maxFileBytes: environment.KNOWLEDGE_MAX_UPLOAD_BYTES,
    previous,
  });
  const seen = new Set<string>();
  const indexJobs: string[] = [];
  const errors: Array<{ locator: string; message: string }> = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let successCount = 0;
  for (const file of scan.files) {
    seen.add(file.locator);
    const prior = previous.get(file.locator);
    const changed = !prior || prior.checksum !== file.checksum;
    if (!changed) unchangedCount += 1;
    else if (prior) changedCount += 1;
    else newCount += 1;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let documentId = prior?.documentId;
      if (changed) {
        const bytes = await readFile(file.absolutePath);
        const created = await createVersion(client, {
          source,
          runId,
          locator: file.locator,
          name: file.locator,
          mimeType: mimeFor(file.locator),
          checksum: file.checksum,
          bytes,
          sourceMetadata: {
            sourceType: "SHARED_FOLDER",
            relativePath: file.locator,
            modifiedAt: file.modifiedAt.toISOString(),
          },
          storageRoot: environment.LOCAL_STORAGE_PATH,
        });
        documentId = created.documentId;
        if (created.indexJobId) indexJobs.push(created.indexJobId);
      }
      await upsertSnapshot(client, {
        sourceId: source.sourceId,
        runId,
        locator: file.locator,
        documentId,
        size: file.size,
        modifiedAt: file.modifiedAt,
        checksum: file.checksum,
        metadata: { relativePath: file.locator },
      });
      await client.query("COMMIT");
      successCount += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      errors.push({
        locator: file.locator,
        message: (error instanceof Error
          ? error.message
          : "File refresh failed"
        ).slice(0, 500),
      });
    } finally {
      client.release();
    }
  }
  const deleted = [...previous.values()].filter(
    (snapshot) => !seen.has(snapshot.locator) && snapshot.documentId,
  );
  if (deleted.length) {
    await pool.query(
      `UPDATE "Document" SET active = false, "sourceDeletedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.documentId)],
    );
    await pool.query(
      `UPDATE "SourceSnapshot" SET status = 'DELETED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.id)],
    );
  }
  for (const indexJobId of indexJobs) {
    try {
      await enqueueIndex(indexJobId);
    } catch (error) {
      errors.push({
        locator: indexJobId,
        message: (error instanceof Error
          ? error.message
          : "Index queue failed"
        ).slice(0, 500),
      });
      await pool.query(
        `UPDATE "DocumentIndexJob" SET status = 'DEAD_LETTER',
                "failureCategory" = 'QUEUE', "errorMessage" = $2,
                "deadLetteredAt" = CURRENT_TIMESTAMP, "completedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
        [indexJobId, errors.at(-1)!.message],
      );
    }
  }
  return {
    newCount,
    changedCount,
    deletedCount: deleted.length,
    unchangedCount,
    successCount,
    errors,
  };
}

async function refreshGoogleDriveFolder(
  pool: Pool,
  source: SourceRow,
  runId: string,
  environment: WorkerEnvironment,
  enqueueIndex: (indexJobId: string) => Promise<void>,
) {
  if (!source.rootPath)
    throw new Error("Google Drive folder configuration is missing.");
  if (!environment.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON)
    throw new Error(
      "Google Drive is not configured. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON and restart the worker.",
    );
  const accessToken = await googleDriveAccessToken(
    environment.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON,
  );
  const previous = await snapshots(pool, source.sourceId);
  const scan = await scanGoogleDriveFolder({
    folderUrl: source.rootPath,
    accessToken,
    includeSubdirectories: source.includeSubdirectories ?? true,
    maxFiles: Math.min(
      source.maxFiles ?? environment.KNOWLEDGE_SHARED_FOLDER_MAX_FILES,
      environment.KNOWLEDGE_SHARED_FOLDER_MAX_FILES,
    ),
    maxFileBytes: environment.KNOWLEDGE_MAX_UPLOAD_BYTES,
  });
  const seen = new Set<string>();
  const indexJobs: string[] = [];
  const errors: Array<{ locator: string; message: string }> = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let successCount = 0;
  for (const file of scan.files) {
    seen.add(file.locator);
    const prior = previous.get(file.locator);
    const changed = !prior || prior.checksum !== file.checksum;
    if (!changed) unchangedCount += 1;
    else if (prior) changedCount += 1;
    else newCount += 1;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      let documentId = prior?.documentId;
      if (changed) {
        const downloaded = await downloadGoogleDriveFile({
          file,
          accessToken,
          maxFileBytes: environment.KNOWLEDGE_MAX_UPLOAD_BYTES,
        });
        const created = await createVersion(client, {
          source,
          runId,
          locator: file.locator,
          name: file.relativePath,
          mimeType: file.mimeType,
          checksum: downloaded.checksum,
          bytes: downloaded.bytes,
          sourceMetadata: {
            sourceType: "GOOGLE_DRIVE",
            googleDriveFileId: file.fileId,
            googleDriveUrl: file.webViewLink,
            relativePath: file.relativePath,
            originalMimeType: file.originalMimeType,
            modifiedAt: file.modifiedAt?.toISOString() ?? null,
          },
          storageRoot: environment.LOCAL_STORAGE_PATH,
        });
        documentId = created.documentId;
        if (created.indexJobId) indexJobs.push(created.indexJobId);
      }
      await upsertSnapshot(client, {
        sourceId: source.sourceId,
        runId,
        locator: file.locator,
        documentId,
        size: file.size,
        modifiedAt: file.modifiedAt,
        checksum: file.checksum,
        canonicalUrl: file.webViewLink,
        metadata: {
          googleDriveFileId: file.fileId,
          relativePath: file.relativePath,
          originalMimeType: file.originalMimeType,
        },
      });
      await client.query("COMMIT");
      successCount += 1;
    } catch (error) {
      await client.query("ROLLBACK");
      errors.push({
        locator: file.relativePath,
        message: (error instanceof Error
          ? error.message
          : "Google Drive file refresh failed"
        ).slice(0, 500),
      });
    } finally {
      client.release();
    }
  }
  const deleted = [...previous.values()].filter(
    (snapshot) => !seen.has(snapshot.locator) && snapshot.documentId,
  );
  if (deleted.length) {
    await pool.query(
      `UPDATE "Document" SET active = false, "sourceDeletedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.documentId)],
    );
    await pool.query(
      `UPDATE "SourceSnapshot" SET status = 'DELETED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.id)],
    );
  }
  for (const indexJobId of indexJobs) {
    try {
      await enqueueIndex(indexJobId);
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : "Index queue failed"
      ).slice(0, 500);
      errors.push({ locator: indexJobId, message });
      await pool.query(
        `UPDATE "DocumentIndexJob" SET status = 'DEAD_LETTER',
                "failureCategory" = 'QUEUE', "errorMessage" = $2,
                "deadLetteredAt" = CURRENT_TIMESTAMP, "completedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
        [indexJobId, message],
      );
    }
  }
  return {
    newCount,
    changedCount,
    deletedCount: deleted.length,
    unchangedCount,
    successCount,
    errors,
  };
}

async function refreshWeb(
  pool: Pool,
  source: SourceRow,
  runId: string,
  environment: WorkerEnvironment,
  enqueueIndex: (indexJobId: string) => Promise<void>,
) {
  if (!source.url || !source.allowedDomains?.length)
    throw new Error("Web source configuration is missing");
  const previous = await snapshots(pool, source.sourceId);
  const root = new URL(source.url);
  root.hash = "";
  const rootUrl = root.href;
  const maxDepth = Math.min(2, Math.max(0, source.crawlDepth ?? 2));
  const maxPages = Math.min(500, Math.max(1, source.maxPages ?? 100));
  const queue: Array<{ url: string; depth: number; parentUrl: string | null }> =
    [{ url: rootUrl, depth: 0, parentUrl: null }];
  const queued = new Set([rootUrl]);
  const visited = new Set<string>();
  const seen = new Set<string>();
  const indexJobs: Array<{ id: string; locator: string }> = [];
  const errors: Array<{ locator: string; message: string }> = [];
  let newCount = 0;
  let changedCount = 0;
  let unchangedCount = 0;
  let successCount = 0;
  let processedCount = 0;
  let crawlTruncated = false;

  const enqueueChildren = (
    parentUrl: string,
    depth: number,
    links: string[],
  ) => {
    if (depth >= maxDepth) return;
    for (const href of links) {
      if (queue.length + processedCount >= maxPages) {
        crawlTruncated = true;
        break;
      }
      try {
        const candidate = new URL(href);
        candidate.hash = "";
        if (candidate.hostname.toLowerCase() !== root.hostname.toLowerCase())
          continue;
        const normalized = candidate.href;
        if (visited.has(normalized) || queued.has(normalized)) continue;
        queued.add(normalized);
        queue.push({ url: normalized, depth: depth + 1, parentUrl });
      } catch {
        // Invalid links are ignored without failing the page that contained them.
      }
    }
  };

  while (queue.length && processedCount < maxPages) {
    const item = queue.shift()!;
    queued.delete(item.url);
    if (visited.has(item.url)) continue;
    visited.add(item.url);
    processedCount += 1;
    seen.add(item.url);
    const prior = previous.get(item.url);
    try {
      const fetched = await fetchWebPage({
        url: item.url,
        // Crawling and redirects are intentionally pinned to the exact host
        // of the configured start URL, even if the legacy allowlist is broader.
        allowedDomains: [root.hostname],
        timeoutMs: Math.min(
          source.timeoutMs ?? environment.KNOWLEDGE_WEB_TIMEOUT_MS,
          environment.KNOWLEDGE_WEB_TIMEOUT_MS,
        ),
        maxBytes: Math.min(
          source.maxBytes ?? environment.KNOWLEDGE_WEB_MAX_BYTES,
          environment.KNOWLEDGE_WEB_MAX_BYTES,
        ),
        maxRedirects: Math.min(
          source.maxRedirects ?? environment.KNOWLEDGE_WEB_MAX_REDIRECTS,
          environment.KNOWLEDGE_WEB_MAX_REDIRECTS,
        ),
        etag: prior?.etag,
        lastModified: prior?.lastModified,
      });
      if (fetched.notModified) {
        visited.add(fetched.finalUrl);
        await pool.query(
          `UPDATE "SourceSnapshot" SET "fetchedAt" = CURRENT_TIMESTAMP,
                  "httpStatus" = 304, "lastSeenRunId" = $3, status = 'ACTIVE',
                  "updatedAt" = CURRENT_TIMESTAMP
            WHERE "sourceId" = $1 AND locator = $2`,
          [source.sourceId, item.url, runId],
        );
        const knownChildren = [...previous.values()]
          .filter((snapshot) => snapshot.metadata?.parentUrl === item.url)
          .map((snapshot) => snapshot.locator);
        enqueueChildren(item.url, item.depth, knownChildren);
        unchangedCount += 1;
        successCount += 1;
        continue;
      }
      visited.add(fetched.finalUrl);
      visited.add(fetched.canonicalUrl);
      const checksum = createHash("sha256").update(fetched.bytes).digest("hex");
      const changed = !prior || prior.checksum !== checksum;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        let documentId = prior?.documentId;
        if (changed) {
          const pageUrl = new URL(fetched.canonicalUrl);
          const stem =
            pageUrl.pathname
              .split("/")
              .filter(Boolean)
              .slice(-3)
              .join("-")
              .replace(/[^a-zA-Z0-9._-]+/g, "-") || pageUrl.hostname;
          const suffix = createHash("sha1")
            .update(item.url)
            .digest("hex")
            .slice(0, 10);
          const created = await createVersion(client, {
            source,
            runId,
            locator: item.url,
            name: `${stem.slice(0, 120)}-${suffix}.${fetched.contentType === "text/html" ? "html" : "txt"}`,
            mimeType:
              fetched.contentType === "text/html" ? "text/html" : "text/plain",
            checksum,
            bytes: fetched.bytes,
            sourceMetadata: {
              sourceType: "WEB",
              url: fetched.finalUrl,
              canonicalUrl: fetched.canonicalUrl,
              crawlDepth: item.depth,
              parentUrl: item.parentUrl,
              fetchedAt: new Date().toISOString(),
              httpStatus: fetched.status,
            },
            storageRoot: environment.LOCAL_STORAGE_PATH,
          });
          documentId = created.documentId;
          if (created.indexJobId)
            indexJobs.push({ id: created.indexJobId, locator: item.url });
        }
        await upsertSnapshot(client, {
          sourceId: source.sourceId,
          runId,
          locator: item.url,
          documentId,
          size: fetched.bytes.length,
          checksum,
          etag: fetched.etag,
          lastModified: fetched.lastModified,
          fetchedAt: new Date(),
          httpStatus: fetched.status,
          canonicalUrl: fetched.canonicalUrl,
          metadata: {
            finalUrl: fetched.finalUrl,
            contentType: fetched.contentType,
            crawlDepth: item.depth,
            parentUrl: item.parentUrl,
          },
        });
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      enqueueChildren(item.url, item.depth, fetched.links);
      if (!changed) unchangedCount += 1;
      else if (prior) changedCount += 1;
      else newCount += 1;
      successCount += 1;
    } catch (error) {
      if (shouldSkipWebCrawlError(error, item.depth)) continue;
      const message = (
        error instanceof Error ? error.message : "Web page refresh failed"
      ).slice(0, 500);
      errors.push({ locator: item.url, message });
      if (item.depth === 0) throw error;
    }
  }

  if (queue.length) crawlTruncated = true;
  if (crawlTruncated)
    errors.push({
      locator: rootUrl,
      message: `Crawl stopped at the configured ${maxPages}-page limit. Previously indexed pages were preserved.`,
    });
  const deleted = crawlTruncated
    ? []
    : [...previous.values()].filter(
        (snapshot) => !seen.has(snapshot.locator) && snapshot.documentId,
      );
  if (deleted.length) {
    await pool.query(
      `UPDATE "Document" SET active = false, "sourceDeletedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.documentId)],
    );
    await pool.query(
      `UPDATE "SourceSnapshot" SET status = 'DELETED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [deleted.map((item) => item.id)],
    );
  }

  for (const job of indexJobs) {
    try {
      await enqueueIndex(job.id);
    } catch (error) {
      const message = (
        error instanceof Error ? error.message : "Index queue failed"
      ).slice(0, 500);
      errors.push({ locator: job.locator, message });
      await pool.query(
        `UPDATE "DocumentIndexJob" SET status = 'DEAD_LETTER',
                "failureCategory" = 'QUEUE', "errorMessage" = $2,
                "deadLetteredAt" = CURRENT_TIMESTAMP, "completedAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
        [job.id, message],
      );
    }
  }
  return {
    newCount,
    changedCount,
    deletedCount: deleted.length,
    unchangedCount,
    successCount,
    errors,
  };
}

export async function processSourceRefreshJob(
  input: {
    sourceId: string;
    refreshRunId?: string;
    trigger?: "MANUAL" | "SCHEDULED";
  },
  pool: Pool,
  environment: WorkerEnvironment,
  enqueueIndex: (indexJobId: string) => Promise<void>,
) {
  const source = await sourceRow(pool, input.sourceId);
  if (!source) throw new Error("Knowledge source was not found or is inactive");
  source.embeddingModel ??= environment.EMBEDDING_MODEL;
  const runId = await ensureRun(
    pool,
    source.sourceId,
    input.refreshRunId,
    input.trigger ?? "SCHEDULED",
  );
  const claimed = await pool.query(
    `UPDATE "SourceRefreshRun" SET status = 'PROCESSING',
            "startedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $1 AND status = 'QUEUED'
      RETURNING id`,
    [runId],
  );
  if (!claimed.rowCount)
    return {
      refreshRunId: runId,
      sourceId: source.sourceId,
      newCount: 0,
      changedCount: 0,
      deletedCount: 0,
      unchangedCount: 0,
      successCount: 0,
      errors: [],
      skipped: true as const,
    };
  try {
    const result =
      source.sourceType === "SHARED_FOLDER"
        ? isGoogleDriveFolderUrl(source.rootPath ?? "")
          ? await refreshGoogleDriveFolder(
              pool,
              source,
              runId,
              environment,
              enqueueIndex,
            )
          : await refreshFolder(pool, source, runId, environment, enqueueIndex)
        : source.sourceType === "WEB"
          ? await refreshWeb(pool, source, runId, environment, enqueueIndex)
          : (() => {
              throw new Error("File upload sources cannot be refreshed");
            })();
    const status = result.errors.length ? "PARTIAL" : "COMPLETED";
    await pool.query(
      `UPDATE "SourceRefreshRun" SET status = $2, "newCount" = $3,
              "changedCount" = $4, "deletedCount" = $5, "unchangedCount" = $6,
              "successCount" = $7, "errorCount" = $8, "errorDetails" = $9::jsonb,
              "completedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = $1`,
      [
        runId,
        status,
        result.newCount,
        result.changedCount,
        result.deletedCount,
        result.unchangedCount,
        result.successCount,
        result.errors.length,
        JSON.stringify(result.errors.slice(0, 100)),
      ],
    );
    await pool.query(
      `UPDATE "KnowledgeSource" SET "lastRefreshAt" = CURRENT_TIMESTAMP,
              "lastRefreshStatus" = $2, "lastRefreshMessage" = $3,
              "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [
        source.sourceId,
        status,
        `${result.newCount} new, ${result.changedCount} changed, ${result.deletedCount} deleted, ${result.unchangedCount} unchanged`,
      ],
    );
    return { refreshRunId: runId, sourceId: source.sourceId, ...result };
  } catch (error) {
    const message = (
      error instanceof Error ? error.message : "Source refresh failed"
    ).slice(0, 1_000);
    await pool.query(
      `UPDATE "SourceRefreshRun" SET status = 'FAILED', "errorCount" = 1,
              "errorDetails" = $2::jsonb, "completedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [runId, JSON.stringify([{ message }])],
    );
    await pool.query(
      `UPDATE "KnowledgeSource" SET "lastRefreshAt" = CURRENT_TIMESTAMP,
              "lastRefreshStatus" = 'FAILED', "lastRefreshMessage" = $2,
              "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [source.sourceId, message],
    );
    throw new Error(message);
  }
}
