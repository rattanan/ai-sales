import { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import type { z } from "zod";
import type { businessInsightFilterSchema } from "@/schemas/business-insight";
import { failure, success } from "@/types/result";
import { enqueueBusinessInsightJob } from "@/server/services/job-queue";
import {
  extractInsightTopics,
  insightWords,
} from "@/packages/insights/topic-analysis";

type InsightFilters = z.infer<typeof businessInsightFilterSchema>;

type AggregateMessage = {
  id: string;
  role: "USER" | "ASSISTANT" | "SYSTEM";
  content: string;
  createdAt: Date;
  latencyMs: number | null;
  errorCode: string | null;
  feedback: { rating: number; reason: string | null } | null;
  citations: Array<{ metadata: unknown }>;
};

type AggregateConversation = {
  id: string;
  botId: string;
  botName: string;
  messages: AggregateMessage[];
};

function normalizedQuestion(value: string) {
  return insightWords(value).slice(0, 18).join(" ");
}

function citationLabel(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return "Unknown source";
  const value = metadata as Record<string, unknown>;
  if (value.sourceType === "DATABASE")
    return typeof value.connectionName === "string"
      ? value.connectionName
      : "Database";
  if (value.sourceType === "LEGACY_API")
    return typeof value.apiName === "string" ? value.apiName : "Legacy API";
  return typeof value.documentName === "string"
    ? value.documentName
    : typeof value.canonicalUrl === "string"
      ? value.canonicalUrl
      : "Knowledge source";
}

export function aggregateBusinessInsight(
  conversations: AggregateConversation[],
) {
  const messages = conversations.flatMap((conversation) =>
    conversation.messages.map((message) => ({ ...message, conversation })),
  );
  const userMessages = messages.filter(({ role }) => role === "USER");
  const assistantMessages = messages.filter(({ role }) => role === "ASSISTANT");
  const topics = extractInsightTopics(userMessages);

  const questionGroups = new Map<
    string,
    { count: number; messageIds: string[] }
  >();
  for (const message of userMessages) {
    const key = normalizedQuestion(message.content);
    if (!key) continue;
    const current = questionGroups.get(key) ?? { count: 0, messageIds: [] };
    current.count += 1;
    current.messageIds.push(message.id);
    questionGroups.set(key, current);
  }
  const repeatedProblems = [...questionGroups.entries()]
    .filter(([, detail]) => detail.count >= 2)
    .map(([topic, detail]) => ({ topic, ...detail }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);

  const gapMessageIds = assistantMessages
    .filter(
      (message) =>
        message.errorCode === "NO_GROUNDED_CONTEXT" ||
        message.feedback?.reason === "MISSING_INFORMATION",
    )
    .map((message) => message.id);
  const gapGroups = new Map<string, { count: number; messageIds: string[] }>();
  for (const message of assistantMessages.filter((item) =>
    gapMessageIds.includes(item.id),
  )) {
    const index = message.conversation.messages.findIndex(
      (item) => item.id === message.id,
    );
    const question = [...message.conversation.messages.slice(0, index)]
      .reverse()
      .find((item) => item.role === "USER");
    const topic = question ? normalizedQuestion(question.content) : "unknown";
    const current = gapGroups.get(topic) ?? { count: 0, messageIds: [] };
    current.count += 1;
    current.messageIds.push(message.id);
    gapGroups.set(topic, current);
  }
  const gapItems = [...gapGroups.entries()]
    .map(([topic, values]) => ({ topic, ...values }))
    .sort((left, right) => right.count - left.count)
    .slice(0, 10);
  const unansweredMessageIds = assistantMessages
    .filter((message) => Boolean(message.errorCode))
    .map((message) => message.id);
  const negative = assistantMessages.filter(
    (message) => message.feedback?.rating === -1,
  );

  const sourceCounts = new Map<
    string,
    { negative: number; total: number; messageIds: string[] }
  >();
  for (const message of assistantMessages)
    for (const citation of message.citations) {
      const label = citationLabel(citation.metadata);
      const current = sourceCounts.get(label) ?? {
        negative: 0,
        total: 0,
        messageIds: [],
      };
      current.total += 1;
      if (message.feedback?.rating === -1) {
        current.negative += 1;
        current.messageIds.push(message.id);
      }
      sourceCounts.set(label, current);
    }
  const lowPerformingSources = [...sourceCounts.entries()]
    .filter(([, value]) => value.negative > 0)
    .map(([source, value]) => ({ source, ...value }))
    .sort((left, right) => right.negative - left.negative)
    .slice(0, 8);

  const botCounts = new Map<
    string,
    { total: number; errors: number; negative: number; messageIds: string[] }
  >();
  for (const message of assistantMessages) {
    const current = botCounts.get(message.conversation.botName) ?? {
      total: 0,
      errors: 0,
      negative: 0,
      messageIds: [],
    };
    current.total += 1;
    if (message.errorCode) current.errors += 1;
    if (message.feedback?.rating === -1) current.negative += 1;
    if (message.errorCode || message.feedback?.rating === -1)
      current.messageIds.push(message.id);
    botCounts.set(message.conversation.botName, current);
  }
  const botPerformance = [...botCounts.entries()]
    .map(([bot, values]) => ({
      bot,
      ...values,
      errorRate: values.total ? values.errors / values.total : 0,
      negativeRate: values.total ? values.negative / values.total : 0,
    }))
    .sort(
      (left, right) =>
        right.errorRate +
          right.negativeRate -
          (left.errorRate + left.negativeRate) ||
        left.bot.localeCompare(right.bot),
    );

  const dayCounts = new Map<
    string,
    {
      messages: number;
      errors: number;
      latencyTotal: number;
      latencyCount: number;
    }
  >();
  for (const message of messages) {
    const day = message.createdAt.toISOString().slice(0, 10);
    const current = dayCounts.get(day) ?? {
      messages: 0,
      errors: 0,
      latencyTotal: 0,
      latencyCount: 0,
    };
    current.messages += 1;
    if (message.errorCode) current.errors += 1;
    if (message.latencyMs != null) {
      current.latencyTotal += message.latencyMs;
      current.latencyCount += 1;
    }
    dayCounts.set(day, current);
  }
  const trends = [...dayCounts.entries()]
    .map(([date, values]) => ({
      date,
      messages: values.messages,
      errors: values.errors,
      averageLatencyMs: values.latencyCount
        ? Math.round(values.latencyTotal / values.latencyCount)
        : 0,
    }))
    .sort((left, right) => left.date.localeCompare(right.date));

  const latencies = assistantMessages
    .flatMap((message) =>
      message.latencyMs == null ? [] : [message.latencyMs],
    )
    .sort((left, right) => left - right);
  const p95LatencyMs = latencies.length
    ? latencies[
        Math.min(latencies.length - 1, Math.ceil(latencies.length * 0.95) - 1)
      ]
    : 0;
  const metrics = {
    conversationCount: conversations.length,
    messageCount: messages.length,
    userMessageCount: userMessages.length,
    assistantMessageCount: assistantMessages.length,
    errorCount: unansweredMessageIds.length,
    errorRate: assistantMessages.length
      ? unansweredMessageIds.length / assistantMessages.length
      : 0,
    negativeFeedbackCount: negative.length,
    averageLatencyMs: latencies.length
      ? Math.round(
          latencies.reduce((sum, value) => sum + value, 0) / latencies.length,
        )
      : 0,
    p95LatencyMs,
  };
  const enoughEvidence = conversations.length >= 3 && messages.length >= 6;
  const limitations = enoughEvidence
    ? []
    : [
        "Insufficient sample: at least 3 conversations and 6 messages are required before drawing organizational conclusions.",
      ];
  const findings: Array<{
    type: string;
    title: string;
    statement: string;
    evidenceCount: number;
    messageIds: string[];
  }> = [];
  if (enoughEvidence && repeatedProblems.length)
    findings.push({
      type: "REPEATED_PROBLEM",
      title: "Repeated question pattern",
      statement: `The most repeated question pattern occurred ${repeatedProblems[0].count} times.`,
      evidenceCount: repeatedProblems[0].count,
      messageIds: repeatedProblems[0].messageIds,
    });
  if (enoughEvidence && gapMessageIds.length)
    findings.push(
      {
        type: "KNOWLEDGE_GAP",
        title: "Knowledge gaps detected",
        statement: `${gapMessageIds.length} assistant responses lacked grounded context or were marked as missing information.`,
        evidenceCount: gapMessageIds.length,
        messageIds: gapMessageIds,
      },
      {
        type: "OPPORTUNITY",
        title: "Knowledge improvement opportunity",
        statement:
          "Prioritize source coverage for the recurring topics associated with grounded-context failures.",
        evidenceCount: gapMessageIds.length,
        messageIds: gapMessageIds,
      },
    );
  if (enoughEvidence && metrics.errorCount)
    findings.push({
      type: "RISK",
      title: "Chat reliability risk",
      statement: `${metrics.errorCount} assistant responses ended with an error (${Math.round(metrics.errorRate * 100)}%).`,
      evidenceCount: metrics.errorCount,
      messageIds: unansweredMessageIds,
    });
  if (enoughEvidence && lowPerformingSources.length)
    findings.push({
      type: "LOW_PERFORMING_SOURCE",
      title: "Source needs review",
      statement: `${lowPerformingSources[0].source} was cited by ${lowPerformingSources[0].negative} negatively rated responses out of ${lowPerformingSources[0].total} cited responses.`,
      evidenceCount: lowPerformingSources[0].negative,
      messageIds: lowPerformingSources[0].messageIds,
    });
  const lowestPerformingBot = botPerformance.find(
    ({ errors, negative }) => errors > 0 || negative > 0,
  );
  if (enoughEvidence && lowestPerformingBot)
    findings.push({
      type: "LOW_PERFORMING_BOT",
      title: "Bot performance needs review",
      statement: `${lowestPerformingBot.bot} had ${lowestPerformingBot.errors} errors and ${lowestPerformingBot.negative} negatively rated responses across ${lowestPerformingBot.total} assistant responses.`,
      evidenceCount: new Set(lowestPerformingBot.messageIds).size,
      messageIds: [...new Set(lowestPerformingBot.messageIds)],
    });
  if (enoughEvidence)
    findings.push({
      type: "RECOMMENDATION",
      title: "Evidence-based next action",
      statement: gapMessageIds.length
        ? "Review the gap messages and add or refresh governed sources before changing prompts."
        : "Continue monitoring topic mix, latency, and feedback as the sample grows.",
      evidenceCount: Math.max(gapMessageIds.length, conversations.length),
      messageIds: gapMessageIds,
    });

  return {
    enoughEvidence,
    metrics,
    trends,
    topics,
    repeatedProblems,
    knowledgeGaps: {
      count: gapMessageIds.length,
      messageIds: gapMessageIds,
      items: gapItems,
    },
    unanswered: {
      count: unansweredMessageIds.length,
      messageIds: unansweredMessageIds,
    },
    lowPerformingSources,
    botPerformance,
    findings,
    limitations,
    evidenceAggregate: {
      conversationIds: conversations.map(({ id }) => id),
      messageIds: messages.map(({ id }) => id),
      gapMessageIds,
      unansweredMessageIds,
    },
  };
}

async function actorScope(context: AuthorizationContext) {
  const [membership, admin] = await Promise.all([
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      include: { projects: true },
    }),
    hasPermission(context, "role.manage"),
  ]);
  return {
    admin,
    organizationUnitId: membership?.organizationUnitId ?? null,
    projectIds: membership?.projects.map(({ projectId }) => projectId) ?? [],
  };
}

export async function queueBusinessInsight(
  context: AuthorizationContext,
  filters: InsightFilters,
) {
  await requirePermission(context, "insight.manage");
  const scope = await actorScope(context);
  const [botCount, unitCount, projectCount, userCount] = await Promise.all([
    filters.botId
      ? db.bot.count({
          where: { id: filters.botId, organizationId: context.organizationId },
        })
      : Promise.resolve(1),
    filters.organizationUnitId
      ? db.organizationUnit.count({
          where: {
            id: filters.organizationUnitId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
    filters.projectId
      ? db.organizationProject.count({
          where: {
            id: filters.projectId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
    filters.userId
      ? db.organizationMember.count({
          where: {
            userId: filters.userId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
  ]);
  if (
    [botCount, unitCount, projectCount, userCount].some((count) => count !== 1)
  )
    return failure(
      "NOT_FOUND",
      "An insight filter is outside this organization.",
    );
  if (
    !scope.admin &&
    ((filters.organizationUnitId &&
      filters.organizationUnitId !== scope.organizationUnitId) ||
      (filters.projectId && !scope.projectIds.includes(filters.projectId)))
  )
    return failure("FORBIDDEN", "The selected filter is outside your scope.");
  if (!scope.admin && filters.userId) {
    const targetInScope = await db.organizationMember.count({
      where: {
        organizationId: context.organizationId,
        userId: filters.userId,
        OR: [
          ...(scope.organizationUnitId
            ? [{ organizationUnitId: scope.organizationUnitId }]
            : []),
          ...(scope.projectIds.length
            ? [{ projects: { some: { projectId: { in: scope.projectIds } } } }]
            : []),
          { userId: context.userId },
        ],
      },
    });
    if (!targetInScope)
      return failure("FORBIDDEN", "The selected user is outside your scope.");
  }
  const dateFrom = new Date(filters.dateFrom);
  dateFrom.setHours(0, 0, 0, 0);
  const dateTo = new Date(filters.dateTo);
  dateTo.setHours(23, 59, 59, 999);
  const job = await db.businessInsightJob.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      requestedById: context.userId,
      botId: filters.botId,
      organizationUnitId: filters.organizationUnitId,
      projectId: filters.projectId,
      userFilterId: filters.userId,
      dateFrom,
      dateTo,
      scopeMetadata: {
        actorMode: scope.admin ? "ORGANIZATION" : "DEPARTMENT_PROJECT",
        actorOrganizationUnitId: scope.organizationUnitId,
        actorProjectIds: scope.projectIds,
      },
    },
  });
  try {
    await enqueueBusinessInsightJob(job.id);
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "BUSINESS_INSIGHT_QUEUED",
        entityType: "BusinessInsightJob",
        entityId: job.id,
        outcome: "SUCCESS",
        metadata: { dateFrom, dateTo, botId: filters.botId ?? null },
      },
    });
    return success({ id: job.id, status: "PROCESSING" as const });
  } catch {
    await db.businessInsightJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "QUEUE_UNAVAILABLE",
        completedAt: new Date(),
      },
    });
    return failure(
      "INTERNAL_ERROR",
      "The insight worker queue is unavailable.",
    );
  }
}

export async function createBusinessInsight(
  context: AuthorizationContext,
  filters: InsightFilters,
) {
  await requirePermission(context, "insight.manage");
  const scope = await actorScope(context);
  const scopedResources = await Promise.all([
    filters.botId
      ? db.bot.count({
          where: { id: filters.botId, organizationId: context.organizationId },
        })
      : Promise.resolve(1),
    filters.organizationUnitId
      ? db.organizationUnit.count({
          where: {
            id: filters.organizationUnitId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
    filters.projectId
      ? db.organizationProject.count({
          where: {
            id: filters.projectId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
    filters.userId
      ? db.organizationMember.count({
          where: {
            userId: filters.userId,
            organizationId: context.organizationId,
          },
        })
      : Promise.resolve(1),
  ]);
  if (scopedResources.some((count) => count !== 1))
    return failure(
      "NOT_FOUND",
      "An insight filter is outside this organization.",
    );
  if (
    !scope.admin &&
    ((filters.organizationUnitId &&
      filters.organizationUnitId !== scope.organizationUnitId) ||
      (filters.projectId && !scope.projectIds.includes(filters.projectId)))
  )
    return failure("FORBIDDEN", "The selected filter is outside your scope.");
  if (!scope.admin && filters.userId) {
    const targetInScope = await db.organizationMember.count({
      where: {
        organizationId: context.organizationId,
        userId: filters.userId,
        OR: [
          ...(scope.organizationUnitId
            ? [{ organizationUnitId: scope.organizationUnitId }]
            : []),
          ...(scope.projectIds.length
            ? [{ projects: { some: { projectId: { in: scope.projectIds } } } }]
            : []),
          { userId: context.userId },
        ],
      },
    });
    if (!targetInScope)
      return failure("FORBIDDEN", "The selected user is outside your scope.");
  }
  const dateFrom = new Date(filters.dateFrom);
  dateFrom.setHours(0, 0, 0, 0);
  const dateTo = new Date(filters.dateTo);
  dateTo.setHours(23, 59, 59, 999);
  const managerScope: Prisma.ConversationWhereInput = scope.admin
    ? {}
    : scope.organizationUnitId || scope.projectIds.length
      ? {
          OR: [
            ...(scope.organizationUnitId
              ? [{ organizationUnitId: scope.organizationUnitId }]
              : []),
            ...(scope.projectIds.length
              ? [{ projectId: { in: scope.projectIds } }]
              : []),
          ],
        }
      : { userId: context.userId };
  const selectedScope: Prisma.ConversationWhereInput = {
    ...(filters.botId ? { botId: filters.botId } : {}),
    ...(filters.organizationUnitId
      ? { organizationUnitId: filters.organizationUnitId }
      : {}),
    ...(filters.projectId ? { projectId: filters.projectId } : {}),
    ...(filters.userId ? { userId: filters.userId } : {}),
  };
  const scopeMetadata = {
    actorMode: scope.admin ? "ORGANIZATION" : "DEPARTMENT_PROJECT",
    actorOrganizationUnitId: scope.organizationUnitId,
    actorProjectIds: scope.projectIds,
  };
  const job = await db.businessInsightJob.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      requestedById: context.userId,
      botId: filters.botId,
      organizationUnitId: filters.organizationUnitId,
      projectId: filters.projectId,
      userFilterId: filters.userId,
      dateFrom,
      dateTo,
      scopeMetadata,
    },
  });
  try {
    const rows = await db.conversation.findMany({
      where: {
        organizationId: context.organizationId,
        deletedAt: null,
        AND: [
          managerScope,
          selectedScope,
          { messages: { some: { createdAt: { gte: dateFrom, lte: dateTo } } } },
        ],
      },
      select: {
        id: true,
        botId: true,
        bot: { select: { name: true } },
        messages: {
          where: { createdAt: { gte: dateFrom, lte: dateTo } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            role: true,
            content: true,
            createdAt: true,
            latencyMs: true,
            errorCode: true,
            feedback: { select: { rating: true, reason: true } },
            citations: { select: { metadata: true } },
          },
        },
      },
      take: 10_000,
    });
    const conversations: AggregateConversation[] = rows.map((row) => ({
      id: row.id,
      botId: row.botId,
      botName: row.bot.name,
      messages: row.messages,
    }));
    const aggregate = aggregateBusinessInsight(conversations);
    const filtersSnapshot = {
      dateFrom: dateFrom.toISOString(),
      dateTo: dateTo.toISOString(),
      botId: filters.botId ?? null,
      organizationUnitId: filters.organizationUnitId ?? null,
      projectId: filters.projectId ?? null,
      userId: filters.userId ?? null,
      scope: scopeMetadata,
    };
    const messageCount = rows.reduce(
      (total, conversation) => total + conversation.messages.length,
      0,
    );
    await db.$transaction([
      db.businessInsightJob.update({
        where: { id: job.id },
        data: {
          status: aggregate.enoughEvidence ? "COMPLETED" : "INSUFFICIENT_DATA",
          conversationCount: rows.length,
          messageCount,
          limitation: aggregate.limitations[0],
          completedAt: new Date(),
        },
      }),
      db.businessInsightSnapshot.create({
        data: {
          jobId: job.id,
          version: 1,
          algorithmVersion: "business-insight-deterministic-v2",
          filters: filtersSnapshot,
          metrics: aggregate.metrics as Prisma.InputJsonValue,
          trends: aggregate.trends as Prisma.InputJsonValue,
          topics: aggregate.topics as Prisma.InputJsonValue,
          knowledgeGaps: aggregate.knowledgeGaps as Prisma.InputJsonValue,
          findings: aggregate.findings as Prisma.InputJsonValue,
          evidenceAggregate:
            aggregate.evidenceAggregate as Prisma.InputJsonValue,
          limitations: aggregate.limitations,
          conversationCount: rows.length,
          messageCount,
        },
      }),
      db.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "BUSINESS_INSIGHT_CREATED",
          entityType: "BusinessInsightJob",
          entityId: job.id,
          outcome: aggregate.enoughEvidence ? "SUCCESS" : "INSUFFICIENT_DATA",
          metadata: {
            dateFrom,
            dateTo,
            filters: filtersSnapshot,
            conversationCount: rows.length,
            messageCount,
            findingCount: aggregate.findings.length,
          },
        },
      }),
    ]);
    return success({
      id: job.id,
      status: aggregate.enoughEvidence
        ? ("COMPLETED" as const)
        : ("INSUFFICIENT_DATA" as const),
    });
  } catch {
    await db.businessInsightJob.update({
      where: { id: job.id },
      data: {
        status: "FAILED",
        errorCode: "AGGREGATION_FAILED",
        completedAt: new Date(),
      },
    });
    return failure("INTERNAL_ERROR", "The insight could not be generated.");
  }
}

export async function canViewBusinessInsight(
  context: AuthorizationContext,
  id: string,
) {
  const job = await db.businessInsightJob.findFirst({
    where: {
      id,
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
    },
    select: { requestedById: true, scopeMetadata: true },
  });
  if (!job) return false;
  if (job.requestedById === context.userId) return true;
  return hasPermission(context, "role.manage");
}
