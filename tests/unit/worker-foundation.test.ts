import { describe, expect, it } from "vitest";
import { processSystemHealthJob } from "@/packages/queue/system-queue";
import { workerEnv } from "@/schemas/worker-env";

describe("Phase 0 worker foundation", () => {
  it("validates isolated worker configuration", () => {
    expect(
      workerEnv({
        DATABASE_URL:
          "postgresql://test:test@database.example.test:5432/insightkm",
        CREDENTIAL_ENCRYPTION_KEY:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        REDIS_URL: "rediss://queue.example.test:6380/1",
        BULLMQ_PREFIX: "insightkm:test",
        WORKER_CONCURRENCY: "7",
        EMBEDDING_BATCH_CONCURRENCY: "3",
      }),
    ).toMatchObject({
      REDIS_URL: "rediss://queue.example.test:6380/1",
      BULLMQ_PREFIX: "insightkm:test",
      WORKER_CONCURRENCY: 7,
      EMBEDDING_BATCH_CONCURRENCY: 3,
    });
    expect(() =>
      workerEnv({
        DATABASE_URL:
          "postgresql://test:test@database.example.test:5432/insightkm",
        CREDENTIAL_ENCRYPTION_KEY:
          "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        REDIS_URL: "https://example.test",
      }),
    ).toThrow();
  });

  it("returns correlation data from the deterministic health processor", () => {
    const result = processSystemHealthJob(
      { requestId: "request-123", requestedAt: new Date(0).toISOString() },
      "worker-1",
    );
    expect(result.requestId).toBe("request-123");
    expect(result.workerId).toBe("worker-1");
    expect(new Date(result.completedAt).toString()).not.toBe("Invalid Date");
  });
});
