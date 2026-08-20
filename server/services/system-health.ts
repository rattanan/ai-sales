import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { getSystemQueueMetrics } from "@/server/services/job-queue";
import {
  getPlatformHealth,
  type HealthCheck,
} from "@/server/services/platform-health";

async function checked(
  check: () => Promise<void>,
  detail: string,
): Promise<HealthCheck> {
  const startedAt = performance.now();
  try {
    await check();
    return {
      status: "up",
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch {
    return {
      status: "down",
      latencyMs: Math.round(performance.now() - startedAt),
      detail,
    };
  }
}

export async function getSystemHealth(organizationId: string) {
  const configuration = env();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1_000);
  const [
    platform,
    vector,
    storage,
    providers,
    chatRows,
    indexRows,
    slowRows,
    queue,
    privacy,
    staleCredentialRows,
  ] = await Promise.all([
    getPlatformHealth(),
    checked(async () => {
      const rows = await db.$queryRawUnsafe<Array<{ extversion: string }>>(
        "SELECT extversion FROM pg_extension WHERE extname = 'vector'",
      );
      if (!rows[0]) throw new Error("vector extension missing");
    }, "pgvector extension is unavailable"),
    checked(async () => {
      const configuration = env();
      if (configuration.OBJECT_STORAGE_DRIVER === "local") {
        await mkdir(configuration.LOCAL_STORAGE_PATH, { recursive: true });
        await access(configuration.LOCAL_STORAGE_PATH);
        const probe = path.join(
          configuration.LOCAL_STORAGE_PATH,
          `.health-${crypto.randomUUID()}`,
        );
        await writeFile(probe, "ok", { flag: "wx", mode: 0o600 });
        await unlink(probe);
      }
    }, "Object storage is unavailable"),
    db.llmProvider.findMany({
      where: { organizationId },
      select: {
        id: true,
        name: true,
        active: true,
        lastHealthStatus: true,
        lastChatHealthStatus: true,
        lastEmbeddingHealthStatus: true,
        lastHealthMessage: true,
        lastTestedAt: true,
        lastChatLatencyMs: true,
        lastEmbeddingLatencyMs: true,
        fallbackEnabled: true,
      },
      orderBy: [{ active: "desc" }, { name: "asc" }],
    }),
    db.$queryRawUnsafe<
      Array<{
        total: number;
        errors: number;
        p95LatencyMs: number | null;
      }>
    >(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE m."errorCode" IS NOT NULL)::int AS errors,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY m."latencyMs")::float AS "p95LatencyMs"
       FROM "ChatMessage" m
       JOIN "Conversation" c ON c.id = m."conversationId"
       WHERE c."organizationId" = $1
         AND m.role = 'ASSISTANT'
         AND m."createdAt" >= $2`,
      organizationId,
      since,
    ),
    db.$queryRawUnsafe<
      Array<{ total: number; completed: number; p95Minutes: number | null }>
    >(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE j.status = 'COMPLETED')::int AS completed,
              (percentile_cont(0.95) WITHIN GROUP (
                ORDER BY extract(epoch FROM (j."completedAt" - j."createdAt")) / 60
              ) FILTER (WHERE j."completedAt" IS NOT NULL))::float AS "p95Minutes"
       FROM "DocumentIndexJob" j
       JOIN "DocumentVersion" v ON v.id = j."documentVersionId"
       JOIN "Document" d ON d.id = v."documentId"
       WHERE d."organizationId" = $1 AND j."createdAt" >= $2`,
      organizationId,
      since,
    ),
    db.$queryRawUnsafe<Array<{ count: number; maximumDurationMs: number }>>(
      `SELECT count(*)::int AS count,
              coalesce(max(extract(epoch FROM (clock_timestamp() - query_start)) * 1000), 0)::float AS "maximumDurationMs"
       FROM pg_stat_activity
       WHERE state = 'active'
         AND pid <> pg_backend_pid()
         AND query_start < clock_timestamp() - make_interval(secs => $1::double precision / 1000)`,
      configuration.SLOW_QUERY_THRESHOLD_MS,
    ),
    getSystemQueueMetrics().catch(() => null),
    db.piiMaskingPolicy.findUnique({ where: { organizationId } }),
    db.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT (
         (SELECT count(*) FROM "LlmProviderCredential" c JOIN "LlmProvider" p ON p.id = c."providerId" WHERE p."organizationId" = $1 AND c."keyVersion" <> $2) +
         (SELECT count(*) FROM "DataSourceCredential" c JOIN "DataSource" d ON d.id = c."dataSourceId" JOIN "Workspace" w ON w.id = d."workspaceId" WHERE w."organizationId" = $1 AND c."keyVersion" <> $2) +
         (SELECT count(*) FROM "LegacyApiCredential" c JOIN "LegacyApi" a ON a.id = c."legacyApiId" WHERE a."organizationId" = $1 AND c."keyVersion" <> $2) +
         (SELECT count(*) FROM "EmbeddedAuthConfig" c JOIN "AuthenticationPolicy" p ON p.id = c."policyId" WHERE p."organizationId" = $1 AND c."keyVersion" <> $2) +
         (SELECT count(*) FROM "ExternalAuthCredential" c JOIN "ExternalAuthConfig" x ON x.id = c."configId" JOIN "AuthenticationPolicy" p ON p.id = x."policyId" WHERE p."organizationId" = $1 AND c."keyVersion" <> $2)
       )::int AS count`,
      organizationId,
      configuration.CREDENTIAL_KEY_VERSION,
    ),
  ]);
  const chat = chatRows[0] ?? { total: 0, errors: 0, p95LatencyMs: null };
  const indexing = indexRows[0] ?? {
    total: 0,
    completed: 0,
    p95Minutes: null,
  };
  const errorRatePercent = chat.total ? (chat.errors / chat.total) * 100 : null;
  const queueDepth = queue
    ? queue.waiting + queue.delayed + queue.active
    : null;
  const allPrivacyMasksEnabled = Boolean(
    privacy?.enabled &&
    privacy.maskEmail &&
    privacy.maskPhone &&
    privacy.maskNationalId &&
    privacy.maskFinancialAccount &&
    privacy.maskPassport &&
    privacy.maskHealth &&
    privacy.maskReligion &&
    privacy.maskBiometric,
  );
  return {
    platform,
    vector,
    storage,
    providers,
    operational: {
      windowHours: 24,
      slos: {
        availability: {
          actual: platform.status === "ok" ? 100 : 0,
          target: configuration.SLO_AVAILABILITY_TARGET_PERCENT,
          met:
            platform.status === "ok" &&
            100 >= configuration.SLO_AVAILABILITY_TARGET_PERCENT,
          sampleCount: 1,
          note: "Current synthetic infrastructure check; use external uptime monitoring for rolling availability.",
        },
        chatP95: {
          actual: chat.p95LatencyMs,
          target: configuration.SLO_CHAT_P95_TARGET_MS,
          met:
            chat.p95LatencyMs == null
              ? null
              : chat.p95LatencyMs <= configuration.SLO_CHAT_P95_TARGET_MS,
          sampleCount: chat.total,
        },
        errorRate: {
          actual: errorRatePercent,
          target: configuration.SLO_ERROR_RATE_TARGET_PERCENT,
          met:
            errorRatePercent == null
              ? null
              : errorRatePercent <= configuration.SLO_ERROR_RATE_TARGET_PERCENT,
          sampleCount: chat.total,
        },
        indexingP95: {
          actual: indexing.p95Minutes,
          target: configuration.SLO_INDEX_P95_TARGET_MINUTES,
          met:
            indexing.p95Minutes == null
              ? null
              : indexing.p95Minutes <=
                configuration.SLO_INDEX_P95_TARGET_MINUTES,
          sampleCount: indexing.total,
          completedCount: indexing.completed,
        },
      },
      queue: {
        counts: queue,
        depth: queueDepth,
        maximumDepth: configuration.QUEUE_MAX_WAITING_JOBS,
        saturated:
          queueDepth == null
            ? null
            : queueDepth >= configuration.QUEUE_MAX_WAITING_JOBS,
      },
      slowQueries: slowRows[0] ?? { count: 0, maximumDurationMs: 0 },
      readiness: [
        {
          key: "privacy",
          label: "All Phase 8 PDPA masks enabled",
          ready: allPrivacyMasksEnabled,
        },
        {
          key: "fallback",
          label: "AI fallback provider configured",
          ready: providers.some((provider) => provider.fallbackEnabled),
        },
        {
          key: "credential-version",
          label: "Credentials use the current encryption-key version",
          ready: (staleCredentialRows[0]?.count ?? 0) === 0,
        },
        {
          key: "worker",
          label: "Background worker is healthy",
          ready: platform.checks.worker.status === "up",
        },
        {
          key: "queue",
          label: "Queue is below the backpressure threshold",
          ready:
            queueDepth != null &&
            queueDepth < configuration.QUEUE_MAX_WAITING_JOBS,
        },
      ],
    },
  };
}
