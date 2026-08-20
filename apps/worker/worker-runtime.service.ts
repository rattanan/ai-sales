import { hostname } from "node:os";
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { Pool } from "pg";
import {
  createRedisConnection,
  BUSINESS_INSIGHT_JOB,
  processSystemHealthJob,
  SYSTEM_HEALTH_JOB,
  SYSTEM_QUEUE,
  DOCUMENT_INDEX_JOB,
  SOURCE_REFRESH_JOB,
  type InsightKmJobData,
  type InsightKmJobResult,
  type SystemHealthJobData,
} from "../../packages/queue/system-queue.js";
import { processDocumentIndexJob } from "../../packages/knowledge/index-document.js";
import { processSourceRefreshJob } from "../../packages/knowledge/refresh-source.js";
import { recoverStaleOperations } from "../../packages/knowledge/recover-operations.js";
import { enforceRetentionPolicies } from "../../packages/operations/retention.js";
import { processBusinessInsightQueueJob } from "../../packages/insights/process-business-insight.js";
import { workerEnv } from "../../schemas/worker-env.js";

@Injectable()
export class WorkerRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerRuntimeService.name);
  private connection?: Redis;
  private database?: Pool;
  private worker?: Worker<InsightKmJobData, InsightKmJobResult>;
  private producer?: Queue<InsightKmJobData, InsightKmJobResult>;
  private recoveryTimer?: NodeJS.Timeout;

  private async ensureQueueCapacity(maximumDepth: number) {
    const counts = await this.producer!.getJobCounts(
      "waiting",
      "delayed",
      "active",
    );
    if (
      (counts.waiting ?? 0) + (counts.delayed ?? 0) + (counts.active ?? 0) >=
      maximumDepth
    )
      throw new Error("QUEUE_BACKPRESSURE");
  }

  private async recover(environment: ReturnType<typeof workerEnv>) {
    const staleBefore = new Date(
      Date.now() - Math.max(60_000, environment.WORKER_HEALTH_TIMEOUT_MS * 6),
    );
    const recovered = await recoverStaleOperations(this.database!, {
      staleBefore,
      enqueueIndex: async (indexJobId) => {
        await this.ensureQueueCapacity(environment.QUEUE_MAX_WAITING_JOBS);
        await this.producer!.add(
          DOCUMENT_INDEX_JOB,
          { indexJobId },
          {
            jobId: `document-index-recovery-${indexJobId}-${Date.now()}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 2_000 },
          },
        );
      },
      enqueueRefresh: async (sourceId, refreshRunId) => {
        await this.ensureQueueCapacity(environment.QUEUE_MAX_WAITING_JOBS);
        await this.producer!.add(
          SOURCE_REFRESH_JOB,
          { sourceId, refreshRunId, trigger: "SCHEDULED" },
          {
            jobId: `source-refresh-recovery-${refreshRunId}-${Date.now()}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 5_000 },
          },
        );
      },
    });
    if (
      recovered.indexJobsRecovered ||
      recovered.refreshRunsRecovered ||
      recovered.cancellationsCompleted
    )
      this.logger.warn(
        `Recovered ${recovered.indexJobsRecovered} index job(s), ${recovered.refreshRunsRecovered} source refresh(es), and ${recovered.cancellationsCompleted} cancellation(s)`,
      );
    for (const error of recovered.errors)
      this.logger.error(`Recovery enqueue failed: ${error}`);
  }

  private async enforceRetention() {
    const result = await enforceRetentionPolicies(this.database!);
    const deleted = Object.values(result).reduce(
      (sum, count) => sum + count,
      0,
    );
    if (deleted)
      this.logger.log(
        `Retention enforcement deleted ${deleted} expired record(s): ${JSON.stringify(result)}`,
      );
  }

  async onModuleInit() {
    const environment = workerEnv();
    const workerId = `${hostname()}:${process.pid}`;
    this.connection = createRedisConnection(environment.REDIS_URL);
    this.database = new Pool({ connectionString: environment.DATABASE_URL });
    this.producer = new Queue(SYSTEM_QUEUE, {
      connection: this.connection,
      prefix: environment.BULLMQ_PREFIX,
    });
    await this.recover(environment);
    await this.enforceRetention();
    this.worker = new Worker<InsightKmJobData, InsightKmJobResult>(
      SYSTEM_QUEUE,
      async (job) => {
        if (job.name === SYSTEM_HEALTH_JOB)
          return processSystemHealthJob(
            job.data as SystemHealthJobData,
            workerId,
          );
        if (job.name === DOCUMENT_INDEX_JOB)
          return processDocumentIndexJob(
            (job.data as { indexJobId: string }).indexJobId,
            this.database!,
            environment,
          );
        if (job.name === SOURCE_REFRESH_JOB) {
          const data = job.data as {
            sourceId: string;
            refreshRunId?: string;
            trigger?: "MANUAL" | "SCHEDULED";
          };
          return processSourceRefreshJob(
            data,
            this.database!,
            environment,
            async (indexJobId) => {
              await this.ensureQueueCapacity(
                environment.QUEUE_MAX_WAITING_JOBS,
              );
              await this.producer!.add(
                DOCUMENT_INDEX_JOB,
                { indexJobId },
                {
                  jobId: `document-index-${indexJobId}-${Date.now()}`,
                  attempts: 3,
                  backoff: { type: "exponential", delay: 2_000 },
                  removeOnComplete: { age: 86_400, count: 1_000 },
                  removeOnFail: { age: 604_800, count: 2_000 },
                },
              );
            },
          );
        }
        if (job.name === BUSINESS_INSIGHT_JOB) {
          const insightId = (job.data as { businessInsightJobId: string })
            .businessInsightJobId;
          try {
            return await processBusinessInsightQueueJob(
              insightId,
              this.database!,
            );
          } catch (error) {
            await this.database!.query(
              `UPDATE "BusinessInsightJob"
                  SET status = 'FAILED', "errorCode" = 'WORKER_FAILED',
                      "completedAt" = CURRENT_TIMESTAMP,
                      "updatedAt" = CURRENT_TIMESTAMP WHERE id = $1`,
              [insightId],
            );
            throw error;
          }
        }
        throw new Error(`Unsupported system job: ${job.name}`);
      },
      {
        connection: this.connection,
        concurrency: environment.WORKER_CONCURRENCY,
        limiter: {
          max: environment.WORKER_RATE_LIMIT_MAX,
          duration: environment.WORKER_RATE_LIMIT_DURATION_MS,
        },
        prefix: environment.BULLMQ_PREFIX,
      },
    );
    this.worker.on("completed", (job) =>
      this.logger.debug(`Completed ${job.name} job ${job.id}`),
    );
    this.worker.on("failed", (job, error) =>
      this.logger.error(`Failed ${job?.name ?? "unknown"} job`, error.stack),
    );
    await this.worker.waitUntilReady();
    this.recoveryTimer = setInterval(
      () => {
        void Promise.all([
          this.recover(environment),
          this.enforceRetention(),
        ]).catch((error) =>
          this.logger.error(
            "Worker maintenance failed",
            error instanceof Error ? error.stack : String(error),
          ),
        );
      },
      Math.max(60_000, environment.WORKER_HEALTH_TIMEOUT_MS * 6),
    );
    this.recoveryTimer.unref();
    this.logger.log(
      `Worker ${workerId} is ready for queue ${environment.BULLMQ_PREFIX}:${SYSTEM_QUEUE}`,
    );
  }

  async onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.worker?.close();
    await this.producer?.close();
    await this.connection?.quit();
    await this.database?.end();
  }
}
