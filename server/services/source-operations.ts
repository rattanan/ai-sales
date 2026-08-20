import "server-only";

import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireKnowledgeRackAccess } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import {
  configuredSharedRoots,
  validatePublicWebUrl,
  validateSharedFolderConfigurationPath,
} from "@/packages/knowledge/source-security";
import {
  canonicalGoogleDriveFolderUrl,
  isGoogleDriveFolderUrl,
} from "@/packages/knowledge/google-drive-url";
import {
  configureSourceRefreshSchedule,
  enqueueDocumentIndexJob,
  enqueueSourceRefreshJob,
} from "@/server/services/job-queue";
import { failure, success } from "@/types/result";

export async function createSharedFolderSource(
  context: AuthorizationContext,
  input: {
    rackId: string;
    name: string;
    rootPath: string;
    includeSubdirectories: boolean;
    scheduleEnabled: boolean;
    intervalMinutes: number;
    maxFiles: number;
  },
) {
  await requireKnowledgeRackAccess(context, input.rackId, "MANAGE");
  const folder = await db.knowledgeRack.findUnique({
    where: { id: input.rackId },
    select: { scope: true, bots: { select: { botId: true } } },
  });
  if (!folder) return failure("NOT_FOUND", "Knowledge folder not found.");
  const configuration = env();
  let canonicalPath: string;
  try {
    if (isGoogleDriveFolderUrl(input.rootPath)) {
      if (!configuration.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON)
        return failure(
          "VALIDATION_ERROR",
          "Google Drive is not configured on this server. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON first.",
        );
      canonicalPath = canonicalGoogleDriveFolderUrl(input.rootPath);
    } else {
      canonicalPath = validateSharedFolderConfigurationPath(
        input.rootPath,
        configuredSharedRoots(configuration.KNOWLEDGE_SHARED_FOLDER_ROOTS),
      );
    }
  } catch (error) {
    return failure(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "The mounted folder is invalid.",
    );
  }
  let source: { id: string; name: string };
  try {
    source = await db.$transaction(async (tx) => {
      const created = await tx.knowledgeSource.create({
        data: {
          rackId: input.rackId,
          name: input.name,
          type: "SHARED_FOLDER",
          scope: folder.scope,
          botAssignments:
            folder.scope === "SELECTED_BOTS" && folder.bots.length
              ? {
                  create: folder.bots.map((item, index) => ({
                    botId: item.botId,
                    priority: 100 + index,
                  })),
                }
              : undefined,
          sharedFolderConfig: {
            create: {
              rootPath: canonicalPath,
              includeSubdirectories: input.includeSubdirectories,
              scheduleEnabled: input.scheduleEnabled,
              intervalMinutes: input.intervalMinutes,
              maxFiles: Math.min(
                input.maxFiles,
                configuration.KNOWLEDGE_SHARED_FOLDER_MAX_FILES,
              ),
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "SHARED_FOLDER_SOURCE_CREATED",
          entityType: "KnowledgeSource",
          entityId: created.id,
          entityName: created.name,
          afterValue: {
            rootPath: canonicalPath,
            includeSubdirectories: input.includeSubdirectories,
            scheduleEnabled: input.scheduleEnabled,
            intervalMinutes: input.intervalMinutes,
          },
        },
      });
      return created;
    });
  } catch {
    return failure(
      "CONFLICT",
      "A knowledge source with this name already exists in the rack.",
    );
  }
  // Queue the first refresh before installing the recurring scheduler. BullMQ
  // may produce a scheduler job immediately; installing it first can therefore
  // make startSourceRefresh see an active run and skip the intended first sync.
  const initialRefresh = await startSourceRefresh(context, source.id);
  let scheduleWarning: string | undefined;
  if (input.scheduleEnabled) {
    try {
      await configureSourceRefreshSchedule({
        sourceId: source.id,
        enabled: true,
        intervalMinutes: input.intervalMinutes,
      });
    } catch {
      await db.$transaction([
        db.sharedFolderSourceConfig.update({
          where: { sourceId: source.id },
          data: { scheduleEnabled: false },
        }),
        db.auditLog.create({
          data: {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            actorId: context.userId,
            action: "KNOWLEDGE_SOURCE_SCHEDULE_FAILED",
            entityType: "KnowledgeSource",
            entityId: source.id,
            entityName: source.name,
            outcome: "FAILED",
            metadata: { reason: "QUEUE_UNAVAILABLE" },
          },
        }),
      ]);
      scheduleWarning =
        "Automatic refresh was disabled because the schedule queue is unavailable.";
    }
  }
  return success({
    id: source.id,
    scheduleWarning,
    refreshWarning: initialRefresh.ok
      ? undefined
      : "The source was created, but its first refresh could not be queued. Use Refresh source to retry.",
  });
}

export async function createWebSource(
  context: AuthorizationContext,
  input: {
    rackId: string;
    name: string;
    url: string;
    allowedDomains: string[];
    timeoutMs: number;
    maxBytes: number;
    maxRedirects: number;
    scheduleEnabled: boolean;
    intervalMinutes: number;
  },
) {
  await requireKnowledgeRackAccess(context, input.rackId, "MANAGE");
  const folder = await db.knowledgeRack.findUnique({
    where: { id: input.rackId },
    select: { scope: true, bots: { select: { botId: true } } },
  });
  if (!folder) return failure("NOT_FOUND", "Knowledge folder not found.");
  const configuration = env();
  const allowedDomains = [
    ...new Set(
      input.allowedDomains.map((domain) => domain.trim().toLowerCase()),
    ),
  ];
  let validated: Awaited<ReturnType<typeof validatePublicWebUrl>>;
  try {
    validated = await validatePublicWebUrl(input.url, allowedDomains);
  } catch (error) {
    return failure(
      "VALIDATION_ERROR",
      error instanceof Error
        ? error.message
        : "The web source URL is not allowed.",
    );
  }
  let source: { id: string; name: string };
  try {
    source = await db.$transaction(async (tx) => {
      const created = await tx.knowledgeSource.create({
        data: {
          rackId: input.rackId,
          name: input.name,
          type: "WEB",
          scope: folder.scope,
          botAssignments:
            folder.scope === "SELECTED_BOTS" && folder.bots.length
              ? {
                  create: folder.bots.map((item, index) => ({
                    botId: item.botId,
                    priority: 100 + index,
                  })),
                }
              : undefined,
          webConfig: {
            create: {
              url: validated.url.href,
              allowedDomains,
              timeoutMs: Math.min(
                input.timeoutMs,
                configuration.KNOWLEDGE_WEB_TIMEOUT_MS,
              ),
              maxBytes: Math.min(
                input.maxBytes,
                configuration.KNOWLEDGE_WEB_MAX_BYTES,
              ),
              maxRedirects: Math.min(
                input.maxRedirects,
                configuration.KNOWLEDGE_WEB_MAX_REDIRECTS,
              ),
              scheduleEnabled: input.scheduleEnabled,
              intervalMinutes: input.intervalMinutes,
            },
          },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "WEB_SOURCE_CREATED",
          entityType: "KnowledgeSource",
          entityId: created.id,
          entityName: created.name,
          afterValue: {
            url: validated.url.href,
            allowedDomains,
            scheduleEnabled: input.scheduleEnabled,
            intervalMinutes: input.intervalMinutes,
          },
        },
      });
      return created;
    });
  } catch {
    return failure(
      "CONFLICT",
      "A knowledge source with this name already exists in the rack.",
    );
  }
  if (input.scheduleEnabled) {
    try {
      await configureSourceRefreshSchedule({
        sourceId: source.id,
        enabled: true,
        intervalMinutes: input.intervalMinutes,
      });
    } catch {
      await db.$transaction([
        db.webSourceConfig.update({
          where: { sourceId: source.id },
          data: { scheduleEnabled: false },
        }),
        db.auditLog.create({
          data: {
            organizationId: context.organizationId,
            workspaceId: context.workspaceId,
            actorId: context.userId,
            action: "KNOWLEDGE_SOURCE_SCHEDULE_FAILED",
            entityType: "KnowledgeSource",
            entityId: source.id,
            entityName: source.name,
            outcome: "FAILED",
            metadata: { reason: "QUEUE_UNAVAILABLE" },
          },
        }),
      ]);
      return success({
        id: source.id,
        scheduleWarning:
          "The source was created, but automatic refresh was disabled because the queue is unavailable.",
      });
    }
  }
  return success({ id: source.id });
}

async function managedSource(context: AuthorizationContext, sourceId: string) {
  const source = await db.knowledgeSource.findFirst({
    where: { id: sourceId, rack: { organizationId: context.organizationId } },
    select: { id: true, name: true, rackId: true, type: true },
  });
  if (!source) return null;
  await requireKnowledgeRackAccess(context, source.rackId, "MANAGE");
  return source;
}

export async function startSourceRefresh(
  context: AuthorizationContext,
  sourceId: string,
) {
  const source = await managedSource(context, sourceId);
  if (!source || source.type === "FILE")
    return failure("NOT_FOUND", "Refreshable knowledge source not found.");
  const active = await db.sourceRefreshRun.count({
    where: { sourceId, status: { in: ["QUEUED", "PROCESSING"] } },
  });
  if (active)
    return failure("CONFLICT", "A refresh is already queued or running.");
  const run = await db.sourceRefreshRun.create({
    data: {
      sourceId,
      trigger: "MANUAL",
      requestedById: context.userId,
    },
  });
  try {
    const queueJobId = await enqueueSourceRefreshJob({
      sourceId,
      refreshRunId: run.id,
      trigger: "MANUAL",
    });
    await db.sourceRefreshRun.update({
      where: { id: run.id },
      data: { queueJobId },
    });
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "KNOWLEDGE_SOURCE_REFRESH_QUEUED",
        entityType: "KnowledgeSource",
        entityId: source.id,
        entityName: source.name,
        metadata: { refreshRunId: run.id, sourceType: source.type },
      },
    });
    return success({ refreshRunId: run.id });
  } catch {
    await db.sourceRefreshRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        errorCount: 1,
        errorDetails: [{ message: "Source refresh queue is unavailable." }],
        completedAt: new Date(),
      },
    });
    return failure("INTERNAL_ERROR", "The refresh could not be queued.");
  }
}

export async function retryIndexJob(
  context: AuthorizationContext,
  indexJobId: string,
) {
  const job = await db.documentIndexJob.findFirst({
    where: {
      id: indexJobId,
      documentVersion: {
        document: { organizationId: context.organizationId },
      },
    },
    include: {
      documentVersion: {
        include: { document: { include: { source: true } } },
      },
    },
  });
  if (!job) return failure("NOT_FOUND", "Index job not found.");
  await requireKnowledgeRackAccess(
    context,
    job.documentVersion.document.source.rackId,
    "MANAGE",
  );
  if (!["FAILED", "DEAD_LETTER", "CANCELLED", "COMPLETED"].includes(job.status))
    return failure(
      "CONFLICT",
      "Only completed, failed, cancelled, or dead-letter jobs can be queued again.",
    );
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
          where: { documentVersionId: job.documentVersionId, embeddingModel },
          orderBy: { updatedAt: "desc" },
        })) ??
        (await db.documentIndexJob.create({
          data: { documentVersionId: job.documentVersionId, embeddingModel },
        })));
  if (["PROCESSING", "CANCEL_REQUESTED"].includes(targetJob.status))
    return failure(
      "CONFLICT",
      "This document is already being re-indexed with the active model.",
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
      where: { id: job.documentVersionId },
      data: { status: "QUEUED", errorMessage: null },
    }),
    db.knowledgeSource.update({
      where: { id: job.documentVersion.document.source.id },
      data: { status: "PROCESSING" },
    }),
  ]);
  try {
    await enqueueDocumentIndexJob(targetJob.id);
    return success({ queued: true as const });
  } catch {
    await db.$transaction([
      db.documentIndexJob.update({
        where: { id: targetJob.id },
        data: {
          status: "DEAD_LETTER",
          failureCategory: "QUEUE",
          errorMessage: "Index queue is unavailable.",
          deadLetteredAt: new Date(),
          completedAt: new Date(),
        },
      }),
      db.documentVersion.update({
        where: { id: job.documentVersionId },
        data: {
          status: "FAILED",
          errorMessage: "Index queue is unavailable.",
        },
      }),
      db.knowledgeSource.update({
        where: { id: job.documentVersion.document.source.id },
        data: { status: "NEEDS_REINDEX" },
      }),
    ]);
    return failure("INTERNAL_ERROR", "The index job could not be queued.");
  }
}

export async function cancelIndexJob(
  context: AuthorizationContext,
  indexJobId: string,
) {
  const job = await db.documentIndexJob.findFirst({
    where: {
      id: indexJobId,
      status: { in: ["QUEUED", "PROCESSING"] },
      documentVersion: { document: { organizationId: context.organizationId } },
    },
    include: {
      documentVersion: { include: { document: { include: { source: true } } } },
    },
  });
  if (!job) return failure("NOT_FOUND", "Cancellable index job not found.");
  await requireKnowledgeRackAccess(
    context,
    job.documentVersion.document.source.rackId,
    "MANAGE",
  );
  await db.documentIndexJob.update({
    where: { id: job.id },
    data: { status: "CANCEL_REQUESTED" },
  });
  return success({ cancelRequested: true as const });
}

export async function reindexSource(
  context: AuthorizationContext,
  sourceId: string,
) {
  const source = await managedSource(context, sourceId);
  if (!source) return failure("NOT_FOUND", "Knowledge source not found.");
  const documents = await db.document.findMany({
    where: { sourceId, active: true },
    select: {
      versions: {
        orderBy: { version: "desc" },
        take: 1,
        select: {
          indexJobs: {
            where: {
              status: {
                in: ["COMPLETED", "FAILED", "DEAD_LETTER", "CANCELLED"],
              },
            },
            orderBy: { updatedAt: "desc" },
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  const jobs = documents.flatMap(
    (document) => document.versions[0]?.indexJobs ?? [],
  );
  let queued = 0;
  for (const job of jobs) {
    const result = await retryIndexJob(context, job.id);
    if (result.ok) queued += 1;
  }
  return success({ queued });
}
