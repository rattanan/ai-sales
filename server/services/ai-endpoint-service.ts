import type { AiEndpointConfig } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import type { AiEndpointInput } from "@/schemas/ai-endpoint";
import { env } from "@/schemas/env";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import { failure, success } from "@/types/result";
import {
  assertEmbeddingCount,
  embeddingAdapter,
} from "@/packages/ai/embedding-adapter";
import { providerHttpError } from "@/packages/ai/provider-http-error";
import { enqueueDocumentIndexJob } from "@/server/services/job-queue";

export function resolvedAiEndpointUrl(
  endpoint: Pick<AiEndpointConfig, "kind" | "providerType" | "baseUrl">,
) {
  const base = endpoint.baseUrl.replace(/\/$/, "");
  if (endpoint.kind === "CHAT")
    return /\/chat\/completions$/.test(base)
      ? base
      : `${base}/chat/completions`;
  return embeddingAdapter(endpoint.providerType).endpoint(base);
}

function endpointEncryption() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

export async function getAiEndpointSecret(endpointId: string) {
  const credential = await db.aiEndpointCredential.findUnique({
    where: { endpointId },
    select: { ciphertext: true, iv: true, authTag: true, keyVersion: true },
  });
  return credential ? endpointEncryption().decrypt(credential) : undefined;
}

export async function activeAiEndpoint(
  organizationId: string,
  kind: "CHAT" | "EMBEDDING",
  endpointId?: string | null,
) {
  return db.aiEndpointConfig.findFirst({
    where: {
      organizationId,
      kind,
      ...(endpointId ? { id: endpointId } : { active: true }),
    },
    orderBy: { updatedAt: "desc" },
  });
}

export async function saveAiEndpoint(
  context: AuthorizationContext,
  input: AiEndpointInput,
) {
  const [existing, activeEmbeddingEndpoint] = await Promise.all([
    input.endpointId
      ? db.aiEndpointConfig.findFirst({
          where: {
            id: input.endpointId,
            organizationId: context.organizationId,
          },
          include: { credential: { select: { id: true } } },
        })
      : Promise.resolve(null),
    input.kind === "EMBEDDING"
      ? db.aiEndpointConfig.findFirst({
          where: {
            organizationId: context.organizationId,
            kind: "EMBEDDING",
            active: true,
          },
          orderBy: { updatedAt: "desc" },
        })
      : Promise.resolve(null),
  ]);
  if (input.endpointId && !existing)
    return failure("NOT_FOUND", "AI endpoint not found.");
  if (!input.apiKey && !input.credentialPresent && existing?.credential)
    input.credentialPresent = true;
  const embeddingContractChanged = Boolean(
    input.kind === "EMBEDDING" &&
    input.active &&
    (!activeEmbeddingEndpoint ||
      activeEmbeddingEndpoint.id !== input.endpointId ||
      activeEmbeddingEndpoint.model !== input.model ||
      activeEmbeddingEndpoint.vectorDimension !==
        (input.vectorDimension ?? null) ||
      activeEmbeddingEndpoint.providerType !== input.providerType ||
      activeEmbeddingEndpoint.baseUrl !== input.baseUrl),
  );
  try {
    const saved = await db.$transaction(async (tx) => {
      if (input.active)
        await tx.aiEndpointConfig.updateMany({
          where: {
            organizationId: context.organizationId,
            kind: input.kind,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          data: { active: false },
        });
      const data = {
        kind: input.kind,
        providerType: input.providerType,
        name: input.name,
        baseUrl: input.baseUrl,
        model: input.model,
        temperature: input.kind === "CHAT" ? input.temperature : null,
        maxTokens: input.kind === "CHAT" ? input.maxTokens : null,
        batchSize: input.kind === "EMBEDDING" ? input.batchSize : null,
        vectorDimension:
          input.kind === "EMBEDDING" ? input.vectorDimension : null,
        timeoutMs: input.timeoutMs,
        maxRetries: input.maxRetries,
        active: input.active,
      };
      const endpoint = existing
        ? await tx.aiEndpointConfig.update({
            where: { id: existing.id },
            data,
          })
        : await tx.aiEndpointConfig.create({
            data: {
              ...data,
              organizationId: context.organizationId,
              createdById: context.userId,
            },
          });
      if (input.apiKey) {
        const encrypted = endpointEncryption().encrypt(input.apiKey);
        await tx.aiEndpointCredential.upsert({
          where: { endpointId: endpoint.id },
          create: { endpointId: endpoint.id, ...encrypted },
          update: encrypted,
        });
      }
      if (embeddingContractChanged) {
        await tx.knowledgeSource.updateMany({
          where: {
            rack: { organizationId: context.organizationId },
            status: { not: "DISABLED" },
          },
          data: { status: "NEEDS_REINDEX" },
        });
      }
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: existing ? "AI_ENDPOINT_UPDATED" : "AI_ENDPOINT_CREATED",
          entityType: "AiEndpointConfig",
          entityId: endpoint.id,
          entityName: endpoint.name,
          beforeValue: existing
            ? {
                kind: existing.kind,
                providerType: existing.providerType,
                baseUrl: existing.baseUrl,
                model: existing.model,
                vectorDimension: existing.vectorDimension,
              }
            : undefined,
          afterValue: {
            kind: endpoint.kind,
            providerType: endpoint.providerType,
            baseUrl: endpoint.baseUrl,
            model: endpoint.model,
            vectorDimension: endpoint.vectorDimension,
            active: endpoint.active,
            credentialConfigured: Boolean(input.apiKey || existing?.credential),
            sourcesMarkedNeedsReindex: embeddingContractChanged,
          },
        },
      });
      return endpoint;
    });
    const reindex = embeddingContractChanged
      ? await queueEmbeddingReindex(context, saved.model)
      : { queued: 0, failed: 0 };
    return success({
      id: saved.id,
      sourcesMarkedNeedsReindex: embeddingContractChanged,
      reindexQueued: reindex.queued,
      reindexFailed: reindex.failed,
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      String(error.code) === "P2002"
    )
      return failure("CONFLICT", "An endpoint with this name already exists.");
    return failure("INTERNAL_ERROR", "The AI endpoint could not be saved.");
  }
}

async function queueEmbeddingReindex(
  context: AuthorizationContext,
  embeddingModel: string,
) {
  const documents = await db.document.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
      currentVersionId: { not: null },
      source: { active: true, status: { not: "DISABLED" } },
    },
    select: { currentVersionId: true, sourceId: true },
  });
  let queued = 0;
  let failed = 0;
  for (const document of documents) {
    if (!document.currentVersionId) continue;
    const existingJob = await db.documentIndexJob.findFirst({
      where: {
        documentVersionId: document.currentVersionId,
        embeddingModel,
      },
      orderBy: { updatedAt: "desc" },
    });
    if (
      existingJob &&
      ["QUEUED", "PROCESSING", "CANCEL_REQUESTED"].includes(existingJob.status)
    )
      continue;
    const job = existingJob
      ? await db.documentIndexJob.update({
          where: { id: existingJob.id },
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
        })
      : await db.documentIndexJob.create({
          data: {
            documentVersionId: document.currentVersionId,
            embeddingModel,
          },
        });
    try {
      await enqueueDocumentIndexJob(job.id);
      queued += 1;
      await db.knowledgeSource.update({
        where: { id: document.sourceId },
        data: { status: "PROCESSING" },
      });
    } catch {
      failed += 1;
      await db.documentIndexJob.update({
        where: { id: job.id },
        data: {
          status: "DEAD_LETTER",
          failureCategory: "QUEUE",
          errorMessage: "Index queue is unavailable.",
          deadLetteredAt: new Date(),
          completedAt: new Date(),
        },
      });
    }
  }
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "EMBEDDING_REINDEX_QUEUED",
      entityType: "AiEndpointConfig",
      metadata: { embeddingModel, queued, failed },
      outcome: failed ? (queued ? "PARTIAL" : "FAILED") : "SUCCESS",
    },
  });
  return { queued, failed };
}

function validVector(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

export async function testAiEndpoint(
  context: AuthorizationContext,
  endpointId: string,
) {
  const endpoint = await db.aiEndpointConfig.findFirst({
    where: { id: endpointId, organizationId: context.organizationId },
  });
  if (!endpoint) return failure("NOT_FOUND", "AI endpoint not found.");
  const apiKey = await getAiEndpointSecret(endpoint.id);
  const started = performance.now();
  try {
    const response = await fetch(resolvedAiEndpointUrl(endpoint), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(
        endpoint.kind === "CHAT"
          ? {
              model: endpoint.model,
              messages: [{ role: "user", content: "Reply with OK" }],
              // Reasoning models may spend the first completion tokens on
              // internal reasoning before producing message.content.
              max_tokens: 128,
              temperature: 0,
            }
          : {
              model: endpoint.model,
              input: "InsightKM embedding health check",
            },
      ),
      signal: AbortSignal.timeout(endpoint.timeoutMs),
    });
    if (!response.ok) throw new Error(await providerHttpError(response));
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const vector =
      endpoint.kind === "EMBEDDING"
        ? assertEmbeddingCount(
            embeddingAdapter(endpoint.providerType).vectors(payload),
            1,
          )[0]
        : undefined;
    if (endpoint.kind === "CHAT" && !payload.choices?.[0]?.message?.content)
      throw new Error("Chat endpoint returned an empty response");
    if (endpoint.kind === "EMBEDDING" && !validVector(vector))
      throw new Error("Embedding endpoint returned an invalid vector");
    const latencyMs = Math.round(performance.now() - started);
    const dimension = vector?.length;
    await db.aiEndpointConfig.update({
      where: { id: endpoint.id },
      data: {
        lastHealthStatus: "HEALTHY",
        lastHealthMessage: "Connection test completed.",
        lastLatencyMs: latencyMs,
        lastDetectedDimension: dimension,
        lastTestedAt: new Date(),
      },
    });
    return success({ latencyMs, dimension, model: endpoint.model });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "TimeoutError"
        ? "The endpoint timed out."
        : error instanceof Error
          ? error.message.slice(0, 300)
          : "The endpoint is not reachable.";
    await db.aiEndpointConfig.update({
      where: { id: endpoint.id },
      data: {
        lastHealthStatus: "UNHEALTHY",
        lastHealthMessage: message,
        lastLatencyMs: null,
        lastDetectedDimension: null,
        lastTestedAt: new Date(),
      },
    });
    return failure("CONNECTION_FAILED", message);
  }
}
