import type { Pool } from "pg";

export type RecoveryResult = {
  indexJobsRecovered: number;
  refreshRunsRecovered: number;
  cancellationsCompleted: number;
  errors: string[];
};

export async function recoverStaleOperations(
  pool: Pool,
  input: {
    staleBefore: Date;
    enqueueIndex: (indexJobId: string) => Promise<void>;
    enqueueRefresh: (sourceId: string, refreshRunId: string) => Promise<void>;
  },
): Promise<RecoveryResult> {
  const result: RecoveryResult = {
    indexJobsRecovered: 0,
    refreshRunsRecovered: 0,
    cancellationsCompleted: 0,
    errors: [],
  };
  const cancelled = await pool.query<{ id: string }>(
    `UPDATE "DocumentIndexJob"
        SET status = 'CANCELLED', "failureCategory" = 'CANCELLED',
            "cancelledAt" = CURRENT_TIMESTAMP, "completedAt" = CURRENT_TIMESTAMP,
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE status = 'CANCEL_REQUESTED'
        AND "updatedAt" < $1
      RETURNING id`,
    [input.staleBefore],
  );
  result.cancellationsCompleted = cancelled.rowCount ?? 0;

  const staleJobs = await pool.query<{ id: string; documentVersionId: string }>(
    `UPDATE "DocumentIndexJob"
        SET status = 'QUEUED', "errorMessage" = 'Recovered after missing or stale queue processing.',
            "updatedAt" = CURRENT_TIMESTAMP
      WHERE (
          status = 'PROCESSING'
          AND COALESCE("lastHeartbeatAt", "startedAt", "updatedAt") < $1
        ) OR (
          status = 'QUEUED'
          AND "updatedAt" < $1
        )
      RETURNING id, "documentVersionId"`,
    [input.staleBefore],
  );
  if (staleJobs.rows.length)
    await pool.query(
      `UPDATE "DocumentVersion" SET status = 'QUEUED', "updatedAt" = CURRENT_TIMESTAMP
        WHERE id = ANY($1::text[])`,
      [staleJobs.rows.map((job) => job.documentVersionId)],
    );
  for (const job of staleJobs.rows) {
    try {
      await input.enqueueIndex(job.id);
      result.indexJobsRecovered += 1;
    } catch (error) {
      result.errors.push(
        error instanceof Error
          ? error.message
          : "Index recovery enqueue failed",
      );
    }
  }

  const staleRefreshes = await pool.query<{ id: string; sourceId: string }>(
    `UPDATE "SourceRefreshRun"
        SET status = 'QUEUED', "updatedAt" = CURRENT_TIMESTAMP
      WHERE status = 'PROCESSING'
        AND COALESCE("startedAt", "updatedAt") < $1
      RETURNING id, "sourceId"`,
    [input.staleBefore],
  );
  for (const run of staleRefreshes.rows) {
    try {
      await input.enqueueRefresh(run.sourceId, run.id);
      result.refreshRunsRecovered += 1;
    } catch (error) {
      result.errors.push(
        error instanceof Error
          ? error.message
          : "Refresh recovery enqueue failed",
      );
    }
  }
  return result;
}
