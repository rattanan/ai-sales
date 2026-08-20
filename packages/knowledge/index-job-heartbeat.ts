import type { Pool } from "pg";

export function startIndexJobHeartbeat(
  pool: Pool,
  indexJobId: string,
  intervalMs: number,
) {
  let stopped = false;
  let updateInFlight = false;

  const timer = setInterval(() => {
    if (stopped || updateInFlight) return;
    updateInFlight = true;
    void pool
      .query(
        `UPDATE "DocumentIndexJob"
            SET "lastHeartbeatAt" = CURRENT_TIMESTAMP,
                "updatedAt" = CURRENT_TIMESTAMP
          WHERE id = $1 AND status = 'PROCESSING'`,
        [indexJobId],
      )
      .catch(() => undefined)
      .finally(() => {
        updateInFlight = false;
      });
  }, intervalMs);
  timer.unref();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
