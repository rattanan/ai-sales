import "dotenv/config";
import { Queue, QueueEvents } from "bullmq";
import {
  createRedisConnection,
  SYSTEM_HEALTH_JOB,
  SYSTEM_QUEUE,
  type SystemHealthJobData,
  type SystemHealthJobResult,
} from "../../packages/queue/system-queue.js";
import { workerEnv } from "../../schemas/worker-env.js";

async function checkWorker() {
  const environment = workerEnv();
  const queueConnection = createRedisConnection(environment.REDIS_URL);
  const eventConnection = createRedisConnection(environment.REDIS_URL);
  const queue = new Queue<SystemHealthJobData, SystemHealthJobResult>(
    SYSTEM_QUEUE,
    {
      connection: queueConnection,
      prefix: environment.BULLMQ_PREFIX,
    },
  );
  const events = new QueueEvents(SYSTEM_QUEUE, {
    connection: eventConnection,
    prefix: environment.BULLMQ_PREFIX,
  });
  const requestId = crypto.randomUUID();

  try {
    await Promise.all([queue.waitUntilReady(), events.waitUntilReady()]);
    const job = await queue.add(
      SYSTEM_HEALTH_JOB,
      { requestId, requestedAt: new Date().toISOString() },
      {
        removeOnComplete: { age: 60, count: 100 },
        removeOnFail: { age: 3_600, count: 25 },
      },
    );
    const result = await job.waitUntilFinished(
      events,
      environment.WORKER_HEALTH_TIMEOUT_MS,
    );
    if (result.requestId !== requestId)
      throw new Error("Worker returned a mismatched health-check request ID");
    process.stdout.write(`${JSON.stringify({ status: "ok", ...result })}\n`);
  } finally {
    await Promise.all([queue.close(), events.close()]);
    await Promise.all([queueConnection.quit(), eventConnection.quit()]);
  }
}

checkWorker().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      status: "error",
      message: error instanceof Error ? error.message : "Worker health failed",
    })}\n`,
  );
  process.exitCode = 1;
});
