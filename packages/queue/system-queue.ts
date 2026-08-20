import IORedis from "ioredis";

export const SYSTEM_QUEUE = "system";
export const SYSTEM_HEALTH_JOB = "health-check";
export const DOCUMENT_INDEX_JOB = "document-index";
export const SOURCE_REFRESH_JOB = "source-refresh";
export const BUSINESS_INSIGHT_JOB = "business-insight";

export type SystemHealthJobData = {
  requestId: string;
  requestedAt: string;
};

export type SystemHealthJobResult = {
  requestId: string;
  workerId: string;
  completedAt: string;
};

export type DocumentIndexJobData = { indexJobId: string };
export type SourceRefreshJobData = {
  sourceId: string;
  refreshRunId?: string;
  trigger: "MANUAL" | "SCHEDULED";
};
export type BusinessInsightJobData = { businessInsightJobId: string };

export type InsightKmJobData =
  | SystemHealthJobData
  | DocumentIndexJobData
  | SourceRefreshJobData
  | BusinessInsightJobData;
export type InsightKmJobResult =
  | SystemHealthJobResult
  | { indexJobId: string; chunkCount: number; skipped?: boolean }
  | {
      refreshRunId: string;
      sourceId: string;
      newCount: number;
      changedCount: number;
      deletedCount: number;
      unchangedCount: number;
      successCount: number;
      errors: Array<{ locator: string; message: string }>;
      skipped?: boolean;
    }
  | {
      businessInsightJobId: string;
      conversationCount: number;
      messageCount: number;
      status: "COMPLETED" | "INSUFFICIENT_DATA";
    };

export function createRedisConnection(redisUrl: string) {
  return new IORedis(redisUrl, {
    enableReadyCheck: true,
    maxRetriesPerRequest: null,
  });
}

export function processSystemHealthJob(
  data: SystemHealthJobData,
  workerId: string,
): SystemHealthJobResult {
  return {
    requestId: data.requestId,
    workerId,
    completedAt: new Date().toISOString(),
  };
}
