import { createHash } from "node:crypto";
import path from "node:path";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireKnowledgeRackAccess } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { isSupportedDocument } from "@/packages/knowledge/document-types";
import { LocalObjectStorageService } from "@/server/storage/local-storage";
import { enqueueDocumentIndexJob } from "@/server/services/job-queue";
import { logger } from "@/server/services/logger";
import { failure, success } from "@/types/result";

function validMagic(bytes: Buffer, fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "pdf") return bytes.subarray(0, 4).toString() === "%PDF";
  if (["docx", "xlsx"].includes(extension ?? ""))
    return bytes[0] === 0x50 && bytes[1] === 0x4b;
  return !bytes.subarray(0, 512).includes(0);
}

const MIME_BY_EXTENSION: Record<string, Set<string>> = {
  pdf: new Set(["application/pdf", "application/octet-stream", ""]),
  docx: new Set([
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
    "",
  ]),
  xlsx: new Set([
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
    "",
  ]),
  csv: new Set(["text/csv", "text/plain", "application/octet-stream", ""]),
  txt: new Set(["text/plain", "application/octet-stream", ""]),
  md: new Set(["text/markdown", "text/plain", "application/octet-stream", ""]),
  markdown: new Set([
    "text/markdown",
    "text/plain",
    "application/octet-stream",
    "",
  ]),
  html: new Set(["text/html", "application/octet-stream", ""]),
  htm: new Set(["text/html", "application/octet-stream", ""]),
};

export function validKnowledgeUploadIdentity(
  fileName: string,
  mimeType: string,
) {
  const normalized = fileName.normalize("NFKC");
  const extension = normalized.split(".").pop()?.toLowerCase() ?? "";
  return (
    normalized.length >= 1 &&
    normalized.length <= 180 &&
    path.basename(normalized) === normalized &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(normalized) &&
    !normalized.startsWith(".") &&
    Boolean(MIME_BY_EXTENSION[extension]?.has(mimeType.toLowerCase()))
  );
}

async function embeddingModelForOrganization(organizationId: string) {
  const [endpoint, provider] = await Promise.all([
    db.aiEndpointConfig.findFirst({
      where: { organizationId, kind: "EMBEDDING", active: true },
      select: { model: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.llmProvider.findFirst({
      where: { organizationId, active: true },
      select: { embeddingModel: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return endpoint?.model ?? provider?.embeddingModel ?? env().EMBEDDING_MODEL;
}

export async function uploadKnowledgeDocument(
  context: AuthorizationContext,
  rackId: string,
  file: File,
  sourceId?: string,
) {
  await requireKnowledgeRackAccess(context, rackId, "UPLOAD");
  const configuration = env();
  if (
    !file.name ||
    !isSupportedDocument(file.name) ||
    !validKnowledgeUploadIdentity(file.name, file.type) ||
    file.size < 1 ||
    file.size > configuration.KNOWLEDGE_MAX_UPLOAD_BYTES
  )
    return failure(
      "FILE_INVALID",
      "Upload a supported PDF, DOCX, XLSX, CSV, TXT, Markdown, or HTML file within the configured size limit.",
    );
  const bytes = Buffer.from(await file.arrayBuffer());
  if (!validMagic(bytes, file.name))
    return failure(
      "FILE_INVALID",
      "The file signature does not match its type.",
    );
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const source = await db.knowledgeSource.findFirst({
    where: {
      rackId,
      rack: { organizationId: context.organizationId },
      ...(sourceId ? { id: sourceId, type: "FILE" as const } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  if (!source) return failure("NOT_FOUND", "Knowledge source not found.");
  const duplicate = await db.document.findFirst({
    where: { sourceId: source.id, checksum },
    select: { id: true, currentVersionId: true },
  });
  if (duplicate)
    return success({
      documentId: duplicate.id,
      duplicate: true as const,
      queued: false as const,
    });
  const storage = new LocalObjectStorageService(
    path.resolve(configuration.LOCAL_STORAGE_PATH),
  );
  let stored: Awaited<ReturnType<LocalObjectStorageService["put"]>>;
  try {
    stored = await storage.put({ bytes, originalName: file.name });
  } catch (error) {
    logger.error("Knowledge file storage failed", {
      sourceId: source.id,
      errorCode:
        error && typeof error === "object" && "code" in error
          ? String(error.code)
          : "UNKNOWN",
    });
    return failure(
      "INTERNAL_ERROR",
      "File storage is unavailable. Check System Health and retry the upload.",
    );
  }
  const embeddingModel = await embeddingModelForOrganization(
    context.organizationId,
  );
  try {
    const created = await db.$transaction(async (tx) => {
      const existing = await tx.document.findUnique({
        where: { sourceId_name: { sourceId: source.id, name: file.name } },
        include: {
          versions: { orderBy: { version: "desc" }, take: 1 },
        },
      });
      const document = existing
        ? await tx.document.update({
            where: { id: existing.id },
            data: {
              checksum,
              mimeType: file.type || "application/octet-stream",
              active: true,
            },
          })
        : await tx.document.create({
            data: {
              organizationId: context.organizationId,
              sourceId: source.id,
              name: file.name,
              mimeType: file.type || "application/octet-stream",
              checksum,
              createdById: context.userId,
            },
          });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          version: (existing?.versions[0]?.version ?? 0) + 1,
          storageKey: stored.key,
          size: stored.size,
          checksum: stored.checksum,
          mimeType: file.type || "application/octet-stream",
          status: "QUEUED",
          uploadedById: context.userId,
        },
      });
      const indexJob = await tx.documentIndexJob.create({
        data: {
          documentVersionId: version.id,
          embeddingModel,
        },
      });
      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: { status: "PROCESSING" },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "KNOWLEDGE_DOCUMENT_UPLOADED",
          entityType: "Document",
          entityId: document.id,
          entityName: file.name,
          metadata: {
            version: version.version,
            size: stored.size,
            checksum: stored.checksum,
            indexJobId: indexJob.id,
          },
        },
      });
      return { document, indexJob };
    });
    try {
      await enqueueDocumentIndexJob(created.indexJob.id);
    } catch {
      await db.$transaction([
        db.documentIndexJob.update({
          where: { id: created.indexJob.id },
          data: {
            status: "FAILED",
            errorMessage: "Index queue is unavailable. Retry indexing.",
          },
        }),
        db.documentVersion.update({
          where: { id: created.indexJob.documentVersionId },
          data: {
            status: "FAILED",
            errorMessage: "Index queue is unavailable. Retry indexing.",
          },
        }),
      ]);
      return failure(
        "INTERNAL_ERROR",
        "The document was stored, but indexing could not be queued. Retry from the rack page.",
      );
    }
    return success({
      documentId: created.document.id,
      duplicate: false as const,
      queued: true as const,
    });
  } catch (error) {
    await storage.delete(stored.key);
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      return failure("CONFLICT", "This document version already exists.");
    throw error;
  }
}

export async function uploadKnowledgeSourceDocument(
  context: AuthorizationContext,
  sourceId: string,
  file: File,
) {
  const source = await db.knowledgeSource.findFirst({
    where: {
      id: sourceId,
      type: "FILE",
      rack: { organizationId: context.organizationId },
    },
    select: { rackId: true },
  });
  if (!source) return failure("NOT_FOUND", "File source not found.");
  return uploadKnowledgeDocument(context, source.rackId, file, sourceId);
}

export async function retryDocumentIndex(
  context: AuthorizationContext,
  documentId: string,
) {
  const document = await db.document.findFirst({
    where: { id: documentId, organizationId: context.organizationId },
    include: {
      source: { select: { rackId: true } },
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        include: { indexJobs: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });
  if (!document) return failure("NOT_FOUND", "Document not found.");
  await requireKnowledgeRackAccess(context, document.source.rackId, "UPLOAD");
  const version = document.versions[0];
  const job = version?.indexJobs[0];
  if (!version || !job)
    return failure("NOT_FOUND", "Document index job not found.");
  const [endpoint, provider] = await Promise.all([
    db.aiEndpointConfig.findFirst({
      where: {
        organizationId: context.organizationId,
        kind: "EMBEDDING",
        active: true,
      },
      select: { model: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.llmProvider.findFirst({
      where: { organizationId: context.organizationId, active: true },
      select: { embeddingModel: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const embeddingModel =
    endpoint?.model ?? provider?.embeddingModel ?? env().EMBEDDING_MODEL;
  const targetJob =
    job.embeddingModel === embeddingModel
      ? job
      : ((await db.documentIndexJob.findFirst({
          where: { documentVersionId: version.id, embeddingModel },
          orderBy: { updatedAt: "desc" },
        })) ??
        (await db.documentIndexJob.create({
          data: { documentVersionId: version.id, embeddingModel },
        })));
  if (["PROCESSING", "CANCEL_REQUESTED"].includes(targetJob.status))
    return failure(
      "CONFLICT",
      "This document is already being indexed with the active model.",
    );
  await db.$transaction([
    db.documentIndexJob.update({
      where: { id: targetJob.id },
      data: {
        status: "QUEUED",
        attempt: 0,
        progressPercent: 0,
        processedChunks: 0,
        failureCategory: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        deadLetteredAt: null,
      },
    }),
    db.documentVersion.update({
      where: { id: version.id },
      data: { status: "QUEUED", errorMessage: null },
    }),
  ]);
  await enqueueDocumentIndexJob(targetJob.id);
  return success({ queued: true as const });
}
