import { createHash } from "node:crypto";
import path from "node:path";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireKnowledgeRackAccess } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import type {
  copiedTextSourceSchema,
  sourceAssignmentSchema,
} from "@/schemas/knowledge";
import { LocalObjectStorageService } from "@/server/storage/local-storage";
import { enqueueDocumentIndexJob } from "@/server/services/job-queue";
import { activeAiEndpoint } from "@/server/services/ai-endpoint-service";
import { logger } from "@/server/services/logger";
import { failure, success } from "@/types/result";
import type { z } from "zod";

type CopiedTextInput = z.infer<typeof copiedTextSourceSchema>;
type AssignmentInput = z.infer<typeof sourceAssignmentSchema>;

async function embeddingModel(organizationId: string) {
  const [endpoint, provider] = await Promise.all([
    activeAiEndpoint(organizationId, "EMBEDDING"),
    db.llmProvider.findFirst({
      where: { organizationId, active: true },
      select: { embeddingModel: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  return endpoint?.model ?? provider?.embeddingModel ?? env().EMBEDDING_MODEL;
}

async function validateBots(context: AuthorizationContext, botIds: string[]) {
  const count = await db.bot.count({
    where: { id: { in: botIds }, organizationId: context.organizationId },
  });
  return count === new Set(botIds).size;
}

export async function saveCopiedTextSource(
  context: AuthorizationContext,
  input: CopiedTextInput,
) {
  await requireKnowledgeRackAccess(context, input.rackId, "MANAGE");
  if (!(await validateBots(context, input.botIds)))
    return failure(
      "VALIDATION_ERROR",
      "The source contains an invalid bot assignment.",
    );
  if (input.scope === "SELECTED_BOTS" && !input.botIds.length)
    return failure("VALIDATION_ERROR", "Select at least one bot.");
  const bytes = Buffer.from(input.content, "utf8");
  const configuration = env();
  if (bytes.length > configuration.KNOWLEDGE_MAX_UPLOAD_BYTES)
    return failure(
      "FILE_INVALID",
      "Copied text exceeds the configured source size limit.",
    );
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  const storage = new LocalObjectStorageService(
    path.resolve(configuration.LOCAL_STORAGE_PATH),
  );
  const stored = await storage.put({
    bytes,
    originalName: `${input.name}.txt`,
  });
  try {
    const model = await embeddingModel(context.organizationId);
    const result = await db.$transaction(async (tx) => {
      const existing = input.sourceId
        ? await tx.knowledgeSource.findFirst({
            where: {
              id: input.sourceId,
              rackId: input.rackId,
              type: "COPIED_TEXT",
              rack: { organizationId: context.organizationId },
            },
            include: {
              documents: {
                where: { sourceLocator: "copied-text" },
                include: {
                  versions: { orderBy: { version: "desc" }, take: 1 },
                },
                take: 1,
              },
            },
          })
        : null;
      if (input.sourceId && !existing) throw new Error("SOURCE_NOT_FOUND");
      const source = existing
        ? await tx.knowledgeSource.update({
            where: { id: existing.id },
            data: {
              name: input.name,
              description: input.description,
              category: input.category,
              tags: input.tags,
              scope: input.scope,
              status: "PROCESSING",
              active: true,
            },
          })
        : await tx.knowledgeSource.create({
            data: {
              rackId: input.rackId,
              name: input.name,
              type: "COPIED_TEXT",
              description: input.description,
              category: input.category,
              tags: input.tags,
              scope: input.scope,
              status: "PROCESSING",
              active: true,
              createdById: context.userId,
            },
          });
      await tx.copiedTextSourceConfig.upsert({
        where: { sourceId: source.id },
        create: { sourceId: source.id, content: input.content, contentHash },
        update: { content: input.content, contentHash },
      });
      await tx.botKnowledgeSource.deleteMany({
        where: { sourceId: source.id },
      });
      if (input.botIds.length)
        await tx.botKnowledgeSource.createMany({
          data: input.botIds.map((botId, index) => ({
            botId,
            sourceId: source.id,
            enabled: true,
            priority: 100 + index,
          })),
        });
      const currentDocument = existing?.documents[0];
      const document = currentDocument
        ? await tx.document.update({
            where: { id: currentDocument.id },
            data: {
              name: `${input.name}.txt`,
              checksum: contentHash,
              active: true,
              sourceMetadata: {
                sourceType: "COPIED_TEXT",
                category: input.category ?? null,
                tags: input.tags,
              },
            },
          })
        : await tx.document.create({
            data: {
              organizationId: context.organizationId,
              sourceId: source.id,
              name: `${input.name}.txt`,
              mimeType: "text/plain",
              checksum: contentHash,
              sourceLocator: "copied-text",
              sourceMetadata: {
                sourceType: "COPIED_TEXT",
                category: input.category ?? null,
                tags: input.tags,
              },
              createdById: context.userId,
            },
          });
      const version = await tx.documentVersion.create({
        data: {
          documentId: document.id,
          version: (currentDocument?.versions[0]?.version ?? 0) + 1,
          storageKey: stored.key,
          size: stored.size,
          checksum: stored.checksum,
          mimeType: "text/plain",
          status: "QUEUED",
          uploadedById: context.userId,
        },
      });
      const indexJob = await tx.documentIndexJob.create({
        data: { documentVersionId: version.id, embeddingModel: model },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: existing
            ? "COPIED_TEXT_SOURCE_UPDATED"
            : "COPIED_TEXT_SOURCE_CREATED",
          entityType: "KnowledgeSource",
          entityId: source.id,
          entityName: source.name,
          metadata: {
            scope: input.scope,
            botCount: input.botIds.length,
            tagCount: input.tags.length,
            contentBytes: stored.size,
            indexJobId: indexJob.id,
          },
        },
      });
      return { source, indexJob };
    });
    try {
      await enqueueDocumentIndexJob(result.indexJob.id);
    } catch {
      await db.$transaction([
        db.documentIndexJob.update({
          where: { id: result.indexJob.id },
          data: {
            status: "FAILED",
            errorMessage: "Index queue is unavailable.",
          },
        }),
        db.knowledgeSource.update({
          where: { id: result.source.id },
          data: {
            status: "FAILED",
            lastRefreshMessage: "Index queue is unavailable.",
          },
        }),
      ]);
      return failure(
        "INTERNAL_ERROR",
        "The source was saved, but indexing could not be queued.",
      );
    }
    return success({ id: result.source.id, queued: true as const });
  } catch (error) {
    await storage.delete(stored.key);
    if (error instanceof Error && error.message === "SOURCE_NOT_FOUND")
      return failure("NOT_FOUND", "Copied text source not found.");
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String(error.code) === "P2002"
    )
      return failure(
        "CONFLICT",
        "A source or document with this name already exists.",
      );
    throw error;
  }
}

export async function updateSourceAssignment(
  context: AuthorizationContext,
  input: AssignmentInput,
) {
  if (!(await validateBots(context, input.botIds)))
    return failure(
      "VALIDATION_ERROR",
      "The source contains an invalid bot assignment.",
    );
  return db.$transaction(async (tx) => {
    if (input.sourceType === "KNOWLEDGE") {
      const source = await tx.knowledgeSource.findFirst({
        where: {
          id: input.sourceId,
          rack: { organizationId: context.organizationId },
        },
      });
      if (!source) return failure("NOT_FOUND", "Source not found.");
      await requireKnowledgeRackAccess(context, source.rackId, "MANAGE");
      await tx.knowledgeSource.update({
        where: { id: source.id },
        data: {
          scope: input.scope,
          active: input.enabled,
          status: input.enabled
            ? source.status === "DISABLED"
              ? "DRAFT"
              : source.status
            : "DISABLED",
        },
      });
      await tx.botKnowledgeSource.deleteMany({
        where: { sourceId: source.id },
      });
      if (input.botIds.length)
        await tx.botKnowledgeSource.createMany({
          data: input.botIds.map((botId, index) => ({
            botId,
            sourceId: source.id,
            enabled: input.enabled,
            priority: input.priority + index,
          })),
        });
    } else if (input.sourceType === "DATABASE") {
      const source = await tx.dataSource.findFirst({
        where: { id: input.sourceId, workspaceId: context.workspaceId },
      });
      if (!source) return failure("NOT_FOUND", "Database source not found.");
      const selectedTableCount = await tx.dataSourceTable.count({
        where: {
          selected: true,
          schema: { dataSourceId: source.id, selected: true },
        },
      });
      await tx.dataSource.update({
        where: { id: source.id },
        data: {
          sourceScope: input.scope,
          sourceStatus: input.enabled
            ? selectedTableCount > 0 && source.status === "CONNECTED"
              ? "READY"
              : "DRAFT"
            : "DISABLED",
        },
      });
      await tx.botDataSource.deleteMany({ where: { dataSourceId: source.id } });
      if (input.botIds.length)
        await tx.botDataSource.createMany({
          data: input.botIds.map((botId, index) => ({
            botId,
            dataSourceId: source.id,
            enabled: input.enabled,
            priority: input.priority + index,
          })),
        });
    } else {
      const source = await tx.legacyApi.findFirst({
        where: {
          id: input.sourceId,
          workspaceId: context.workspaceId,
          organizationId: context.organizationId,
        },
      });
      if (!source) return failure("NOT_FOUND", "API tool not found.");
      await tx.legacyApi.update({
        where: { id: source.id },
        data: {
          sourceScope: input.scope,
          enabled: input.enabled,
          sourceStatus: input.enabled
            ? source.sourceStatus === "DISABLED"
              ? "DRAFT"
              : source.sourceStatus
            : "DISABLED",
        },
      });
      await tx.botLegacyApi.deleteMany({ where: { legacyApiId: source.id } });
      if (input.botIds.length)
        await tx.botLegacyApi.createMany({
          data: input.botIds.map((botId, index) => ({
            botId,
            legacyApiId: source.id,
            enabled: input.enabled,
            priority: input.priority + index,
          })),
        });
    }
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "SOURCE_ASSIGNMENT_UPDATED",
        entityType: input.sourceType,
        entityId: input.sourceId,
        afterValue: {
          scope: input.scope,
          botIds: input.botIds,
          enabled: input.enabled,
          priority: input.priority,
        },
      },
    });
    return success({ updated: true as const });
  });
}

export async function archiveKnowledgeSource(
  context: AuthorizationContext,
  sourceId: string,
) {
  const source = await db.knowledgeSource.findFirst({
    where: {
      id: sourceId,
      rack: { organizationId: context.organizationId },
    },
  });
  if (!source) return failure("NOT_FOUND", "Source not found.");
  await requireKnowledgeRackAccess(context, source.rackId, "MANAGE");
  await db.$transaction([
    db.knowledgeSource.update({
      where: { id: source.id },
      data: { active: false, status: "DISABLED" },
    }),
    db.botKnowledgeSource.deleteMany({ where: { sourceId: source.id } }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "KNOWLEDGE_SOURCE_ARCHIVED",
        entityType: "KnowledgeSource",
        entityId: source.id,
        entityName: source.name,
        outcome: "SUCCESS",
      },
    }),
  ]);
  return success({ archived: true as const });
}

async function deleteStoredKnowledgeObjects(
  keys: string[],
  context: { requestId: string; entityId: string; entityType: string },
) {
  if (!keys.length) return;
  const configuration = env();
  if (configuration.OBJECT_STORAGE_DRIVER !== "local") {
    logger.warn(
      "Deleted knowledge records left object-storage cleanup pending",
      {
        ...context,
        objectCount: keys.length,
        storageDriver: configuration.OBJECT_STORAGE_DRIVER,
      },
    );
    return;
  }
  const storage = new LocalObjectStorageService(
    path.resolve(configuration.LOCAL_STORAGE_PATH),
  );
  const results = await Promise.allSettled(
    keys.map((key) => storage.delete(key)),
  );
  const failedCount = results.filter(
    (result) => result.status === "rejected",
  ).length;
  if (failedCount)
    logger.error("Deleted knowledge records left object-storage orphans", {
      ...context,
      objectCount: keys.length,
      failedCount,
    });
}

export async function deleteKnowledgeSource(
  context: AuthorizationContext,
  sourceId: string,
  confirmationName: string,
) {
  const source = await db.knowledgeSource.findFirst({
    where: {
      id: sourceId,
      rack: { organizationId: context.organizationId },
    },
    include: {
      documents: {
        select: { versions: { select: { storageKey: true } } },
      },
      _count: { select: { documents: true } },
    },
  });
  if (!source) return failure("NOT_FOUND", "Source not found.");
  await requireKnowledgeRackAccess(context, source.rackId, "MANAGE");
  if (confirmationName !== source.name)
    return failure(
      "VALIDATION_ERROR",
      "The confirmation name does not match the source name.",
      { fieldErrors: { confirmationName: ["Enter the exact source name."] } },
    );

  const requestId = crypto.randomUUID();
  const storageKeys = source.documents.flatMap((document) =>
    document.versions.map((version) => version.storageKey),
  );
  await db.$transaction(async (tx) => {
    await tx.knowledgeSource.delete({ where: { id: source.id } });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "KNOWLEDGE_SOURCE_DELETED",
        entityType: "KnowledgeSource",
        entityId: source.id,
        entityName: source.name,
        requestId,
        beforeValue: {
          type: source.type,
          documentCount: source._count.documents,
          storedObjectCount: storageKeys.length,
        },
      },
    });
  });
  await deleteStoredKnowledgeObjects(storageKeys, {
    requestId,
    entityId: source.id,
    entityType: "KnowledgeSource",
  });
  return success({ deleted: true as const, id: source.id });
}

export async function deleteKnowledgeFolder(
  context: AuthorizationContext,
  folderId: string,
  confirmationName: string,
) {
  const folder = await db.knowledgeRack.findFirst({
    where: { id: folderId, organizationId: context.organizationId },
    include: {
      sources: {
        select: {
          _count: { select: { documents: true } },
        },
      },
      _count: { select: { sources: true } },
    },
  });
  if (!folder) return failure("NOT_FOUND", "Folder not found.");
  await requireKnowledgeRackAccess(context, folder.id, "MANAGE");
  const documentCount = folder.sources.reduce(
    (total, source) => total + source._count.documents,
    0,
  );
  if (documentCount > 0)
    return failure(
      "CONFLICT",
      "Remove all documents before deleting this folder.",
      { diagnostics: { documentCount } },
    );
  if (confirmationName !== folder.name)
    return failure(
      "VALIDATION_ERROR",
      "The confirmation name does not match the folder name.",
      { fieldErrors: { confirmationName: ["Enter the exact folder name."] } },
    );

  const requestId = crypto.randomUUID();
  const deleted = await db.$transaction(async (tx) => {
    const result = await tx.knowledgeRack.deleteMany({
      where: {
        id: folder.id,
        sources: { none: { documents: { some: {} } } },
      },
    });
    if (!result.count) return false;
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "KNOWLEDGE_FOLDER_DELETED",
        entityType: "KnowledgeRack",
        entityId: folder.id,
        entityName: folder.name,
        requestId,
        beforeValue: {
          sourceCount: folder._count.sources,
          storedObjectCount: 0,
        },
      },
    });
    return true;
  });
  if (!deleted)
    return failure(
      "CONFLICT",
      "Remove all documents before deleting this folder.",
    );
  return success({ deleted: true as const, id: folder.id });
}
