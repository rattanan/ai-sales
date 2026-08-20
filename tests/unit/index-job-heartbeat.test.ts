import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startIndexJobHeartbeat } from "@/packages/knowledge/index-job-heartbeat";

describe("document index job heartbeat", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a processing job alive while an embedding request is pending", async () => {
    vi.useFakeTimers();
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 });
    const stop = startIndexJobHeartbeat(
      { query } as unknown as Pool,
      "index-job-1",
      1_000,
    );

    await vi.advanceTimersByTimeAsync(3_100);

    expect(query).toHaveBeenCalledTimes(3);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = $1 AND status = 'PROCESSING'"),
      ["index-job-1"],
    );

    stop();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(query).toHaveBeenCalledTimes(3);
  });
});
