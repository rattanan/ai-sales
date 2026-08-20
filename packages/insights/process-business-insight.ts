import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { extractInsightTopics } from "./topic-analysis";

type JobRow = {
  id: string;
  organizationId: string;
  workspaceId: string;
  requestedById: string;
  botId: string | null;
  organizationUnitId: string | null;
  projectId: string | null;
  userFilterId: string | null;
  dateFrom: Date;
  dateTo: Date;
  scopeMetadata: {
    actorMode?: string;
    actorOrganizationUnitId?: string | null;
    actorProjectIds?: string[];
  };
};

type MessageRow = {
  id: string;
  conversationId: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: Date;
  latencyMs: number | null;
  errorCode: string | null;
  rating: number | null;
};

export function buildDailyTrends(
  messages: Pick<MessageRow, "createdAt" | "errorCode" | "latencyMs">[],
) {
  const days = new Map<
    string,
    {
      messages: number;
      errors: number;
      latencyTotal: number;
      latencyCount: number;
    }
  >();

  for (const message of messages) {
    const date = message.createdAt.toISOString().slice(0, 10);
    const values = days.get(date) ?? {
      messages: 0,
      errors: 0,
      latencyTotal: 0,
      latencyCount: 0,
    };
    values.messages += 1;
    if (message.errorCode) values.errors += 1;
    if (message.latencyMs != null) {
      values.latencyTotal += message.latencyMs;
      values.latencyCount += 1;
    }
    days.set(date, values);
  }

  return [...days.entries()]
    .map(([date, values]) => ({
      date,
      messages: values.messages,
      errors: values.errors,
      averageLatencyMs: values.latencyCount
        ? Math.round(values.latencyTotal / values.latencyCount)
        : 0,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));
}

export async function processBusinessInsightQueueJob(
  businessInsightJobId: string,
  pool: Pool,
) {
  const jobResult = await pool.query<JobRow>(
    `SELECT id, "organizationId", "workspaceId", "requestedById", "botId",
            "organizationUnitId", "projectId", "userFilterId", "dateFrom",
            "dateTo", "scopeMetadata"
       FROM "BusinessInsightJob" WHERE id = $1`,
    [businessInsightJobId],
  );
  const job = jobResult.rows[0];
  if (!job) throw new Error("Business insight job was not found");
  const actorUnit = job.scopeMetadata.actorOrganizationUnitId ?? null;
  const actorProjects = job.scopeMetadata.actorProjectIds ?? [];
  const organizationWide = job.scopeMetadata.actorMode === "ORGANIZATION";
  const conversations = await pool.query<{ id: string }>(
    `SELECT c.id
       FROM "Conversation" c
      WHERE c."organizationId" = $1 AND c."deletedAt" IS NULL
        AND ($2::text IS NULL OR c."botId" = $2)
        AND ($3::text IS NULL OR c."organizationUnitId" = $3)
        AND ($4::text IS NULL OR c."projectId" = $4)
        AND ($5::text IS NULL OR c."userId" = $5)
        AND ($6::boolean OR c."userId" = $7
          OR ($8::text IS NOT NULL AND c."organizationUnitId" = $8)
          OR (cardinality($9::text[]) > 0 AND c."projectId" = ANY($9::text[])))
        AND EXISTS (
          SELECT 1 FROM "ChatMessage" m
           WHERE m."conversationId" = c.id AND m."createdAt" BETWEEN $10 AND $11
        )
      ORDER BY c."lastMessageAt" DESC LIMIT 10000`,
    [
      job.organizationId,
      job.botId,
      job.organizationUnitId,
      job.projectId,
      job.userFilterId,
      organizationWide,
      job.requestedById,
      actorUnit,
      actorProjects,
      job.dateFrom,
      job.dateTo,
    ],
  );
  const conversationIds = conversations.rows.map(({ id }) => id);
  const messages = conversationIds.length
    ? await pool.query<MessageRow>(
        `SELECT m.id, m."conversationId", m.role::text, m.content, m."createdAt", m."latencyMs",
                m."errorCode", f.rating
           FROM "ChatMessage" m
           LEFT JOIN "ChatMessageFeedback" f ON f."messageId" = m.id
          WHERE m."conversationId" = ANY($1::text[])
            AND m."createdAt" BETWEEN $2 AND $3
          ORDER BY m."createdAt" ASC`,
        [conversationIds, job.dateFrom, job.dateTo],
      )
    : { rows: [] as MessageRow[] };
  const userMessages = messages.rows.filter(({ role }) => role === "USER");
  const assistantMessages = messages.rows.filter(
    ({ role }) => role === "ASSISTANT",
  );
  const topics = extractInsightTopics(userMessages);
  const unanswered = assistantMessages.filter(({ errorCode }) => errorCode);
  const gaps = assistantMessages.filter(
    ({ errorCode }) => errorCode === "NO_GROUNDED_CONTEXT",
  );
  const latencies = assistantMessages
    .map(({ latencyMs }) => latencyMs)
    .filter((value): value is number => value != null)
    .sort((left, right) => left - right);
  const metrics = {
    conversationCount: conversationIds.length,
    messageCount: messages.rows.length,
    questionCount: userMessages.length,
    answeredCount: assistantMessages.length - unanswered.length,
    unansweredCount: unanswered.length,
    errorCount: unanswered.length,
    errorRate: assistantMessages.length
      ? unanswered.length / assistantMessages.length
      : 0,
    positiveFeedbackCount: assistantMessages.filter(
      ({ rating }) => rating === 1,
    ).length,
    negativeFeedbackCount: assistantMessages.filter(
      ({ rating }) => rating === -1,
    ).length,
    averageLatencyMs: latencies.length
      ? Math.round(
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
        )
      : 0,
    p95LatencyMs:
      latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? 0,
  };
  const trends = buildDailyTrends(messages.rows);
  const enoughEvidence =
    conversationIds.length >= 3 && messages.rows.length >= 6;
  const findings = enoughEvidence
    ? [
        ...(gaps.length
          ? [
              {
                type: "KNOWLEDGE_GAP",
                title: "Grounded answers are missing",
                statement: `${gaps.length} responses had no permitted grounded context.`,
                evidenceCount: gaps.length,
                messageIds: gaps.map(({ id }) => id),
              },
            ]
          : []),
        ...(topics[0]
          ? [
              {
                type: "TOPIC_TREND",
                title: `Top topic: ${topics[0].topic}`,
                statement: `${topics[0].topic} appeared in ${topics[0].count} questions.`,
                evidenceCount: topics[0].count,
                messageIds: topics[0].messageIds,
              },
            ]
          : []),
      ]
    : [];
  const limitations = enoughEvidence
    ? ["Topic grouping is deterministic and evidence-bound."]
    : [
        "Insufficient sample: at least 3 conversations and 6 messages are required for conclusions.",
      ];
  const status = enoughEvidence ? "COMPLETED" : "INSUFFICIENT_DATA";
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE "BusinessInsightJob"
          SET status = $2::"BusinessInsightJobStatus", "conversationCount" = $3,
              "messageCount" = $4, limitation = $5, "completedAt" = CURRENT_TIMESTAMP,
              "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
      [
        businessInsightJobId,
        status,
        conversationIds.length,
        messages.rows.length,
        limitations[0],
      ],
    );
    await client.query(
      `INSERT INTO "BusinessInsightSnapshot"
        (id, "jobId", version, "algorithmVersion", filters, metrics, trends,
         topics, "knowledgeGaps", findings, "evidenceAggregate", limitations,
         "conversationCount", "messageCount", "createdAt")
       VALUES ($1, $2, 1, 'business-insight-worker-v3', $3::jsonb, $4::jsonb,
               $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb,
               $10::text[], $11, $12, CURRENT_TIMESTAMP)
       ON CONFLICT ("jobId", version) DO NOTHING`,
      [
        randomUUID(),
        businessInsightJobId,
        JSON.stringify({
          dateFrom: job.dateFrom,
          dateTo: job.dateTo,
          botId: job.botId,
          organizationUnitId: job.organizationUnitId,
          projectId: job.projectId,
          userId: job.userFilterId,
          scope: job.scopeMetadata,
        }),
        JSON.stringify(metrics),
        JSON.stringify(trends),
        JSON.stringify(topics),
        JSON.stringify({
          count: gaps.length,
          messageIds: gaps.map(({ id }) => id),
          items: gaps.map(({ id }) => ({
            topic: "no grounded context",
            count: 1,
            messageIds: [id],
          })),
        }),
        JSON.stringify(findings),
        JSON.stringify({
          conversationIds,
          messageIds: messages.rows.map(({ id }) => id),
          gapMessageIds: gaps.map(({ id }) => id),
          unansweredMessageIds: unanswered.map(({ id }) => id),
        }),
        limitations,
        conversationIds.length,
        messages.rows.length,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return {
    businessInsightJobId,
    conversationCount: conversationIds.length,
    messageCount: messages.rows.length,
    status,
  } as const;
}
