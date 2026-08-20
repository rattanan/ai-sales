import type { Pool } from "pg";

export type RetentionResult = {
  auditLogs: number;
  loginHistory: number;
  conversations: number;
  memories: number;
  externalSessions: number;
  embeddedNonces: number;
  aiCacheEntries: number;
};

export async function enforceRetentionPolicies(
  database: Pick<Pool, "query">,
): Promise<RetentionResult> {
  const result = await database.query<RetentionResult>(`
    WITH
    deleted_audit AS (
      DELETE FROM "AuditLog" a
      USING "SystemRetentionPolicy" p
      WHERE a."organizationId" = p."organizationId"
        AND a."createdAt" < now() - make_interval(days => p."auditLogDays")
      RETURNING 1
    ),
    deleted_login AS (
      DELETE FROM "LoginHistory" l
      WHERE (
        l."organizationId" IS NULL
        AND l."createdAt" < now() - interval '180 days'
      ) OR EXISTS (
        SELECT 1 FROM "SystemRetentionPolicy" p
        WHERE p."organizationId" = l."organizationId"
          AND l."createdAt" < now() - make_interval(days => p."loginHistoryDays")
      )
      RETURNING 1
    ),
    deleted_conversation AS (
      DELETE FROM "Conversation" c
      USING "SystemRetentionPolicy" p
      WHERE c."organizationId" = p."organizationId"
        AND c."lastMessageAt" < now() - make_interval(days => p."chatHistoryDays")
      RETURNING 1
    ),
    deleted_memory AS (
      DELETE FROM "UserMemory"
      WHERE "expiresAt" <= now()
      RETURNING 1
    ),
    deleted_external_session AS (
      DELETE FROM "ExternalSession"
      WHERE "expiresAt" < now() - interval '7 days'
      RETURNING 1
    ),
    deleted_nonce AS (
      DELETE FROM "EmbeddedAuthNonce"
      WHERE "expiresAt" < now() - interval '1 day'
      RETURNING 1
    ),
    deleted_cache AS (
      DELETE FROM "AiResponseCache"
      WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= now()
      RETURNING 1
    )
    SELECT
      (SELECT count(*)::int FROM deleted_audit) AS "auditLogs",
      (SELECT count(*)::int FROM deleted_login) AS "loginHistory",
      (SELECT count(*)::int FROM deleted_conversation) AS "conversations",
      (SELECT count(*)::int FROM deleted_memory) AS "memories",
      (SELECT count(*)::int FROM deleted_external_session) AS "externalSessions",
      (SELECT count(*)::int FROM deleted_nonce) AS "embeddedNonces",
      (SELECT count(*)::int FROM deleted_cache) AS "aiCacheEntries"
  `);
  return (
    result.rows[0] ?? {
      auditLogs: 0,
      loginHistory: 0,
      conversations: 0,
      memories: 0,
      externalSessions: 0,
      embeddedNonces: 0,
      aiCacheEntries: 0,
    }
  );
}
