import { Queue } from "bullmq";
import { db } from "../db";
import {
  createRedisConnection,
  SYSTEM_QUEUE,
} from "../../packages/queue/system-queue";
import { env } from "../../schemas/env";

export type HealthCheck = {
  status: "up" | "down";
  latencyMs: number;
  detail?: string;
};

export type PlatformHealth = {
  status: "ok" | "degraded";
  checkedAt: string;
  checks: {
    application: HealthCheck;
    database: HealthCheck;
    redis: HealthCheck;
    worker: HealthCheck & { activeWorkers?: number };
  };
};

async function measure(
  check: () => Promise<void>,
  failureDetail: string,
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
      detail: failureDetail,
    };
  }
}

export async function getPlatformHealth(): Promise<PlatformHealth> {
  const environment = env();
  const database = await measure(async () => {
    await db.$queryRawUnsafe("SELECT 1");
  }, "Database health check failed");

  const redisConnection = createRedisConnection(environment.REDIS_URL);
  const queue = new Queue(SYSTEM_QUEUE, {
    connection: redisConnection,
    prefix: process.env.BULLMQ_PREFIX ?? "insightkm",
  });
  let activeWorkers: number | undefined;
  const redis = await measure(async () => {
    const response = await redisConnection.ping();
    if (response !== "PONG") throw new Error("Redis did not return PONG");
  }, "Redis health check failed");
  const worker = await measure(async () => {
    const workers = await queue.getWorkers();
    activeWorkers = workers.length;
    if (activeWorkers === 0) throw new Error("No active workers registered");
  }, "No active workers registered");
  await queue.close().catch(() => undefined);
  redisConnection.disconnect();

  const checks = {
    application: { status: "up", latencyMs: 0 } as const,
    database,
    redis,
    worker: { ...worker, activeWorkers },
  };
  return {
    status: Object.values(checks).every((check) => check.status === "up")
      ? "ok"
      : "degraded",
    checkedAt: new Date().toISOString(),
    checks,
  };
}
