"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw, Square } from "lucide-react";
import { Button } from "@/components/ui/button";

type JobState = {
  id: string;
  status:
    | "QUEUED"
    | "RUNNING"
    | "WAITING_FOR_APPROVAL"
    | "COMPLETED"
    | "FAILED"
    | "CANCELLED";
  currentStage: string;
  progressPercent: number;
  errorCode: string | null;
  errorMessage: string | null;
  lastHeartbeatAt: string | Date | null;
};

export function AnalysisRunner({ initialJob }: { initialJob: JobState }) {
  const router = useRouter();
  const [job, setJob] = useState(initialJob);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const running = useRef(false);

  const refreshJob = useCallback(async () => {
    const response = await fetch(`/api/analysis-jobs/${job.id}`);
    const result = await response.json();
    if (result.ok) setJob(result.data);
  }, [job.id]);

  const advance = useCallback(async () => {
    if (running.current || !["QUEUED", "RUNNING"].includes(job.status)) return;
    running.current = true;
    setMessage(null);
    try {
      const response = await fetch(`/api/analysis-jobs/${job.id}/advance`, {
        method: "POST",
      });
      const result = await response.json();
      if (result.ok) {
        setJob(result.data);
        if (["WAITING_FOR_APPROVAL", "COMPLETED"].includes(result.data.status))
          router.refresh();
      } else if (result.error.code === "CONFLICT") {
        await refreshJob();
      } else {
        setMessage(result.error.message);
        await refreshJob();
      }
    } catch {
      setMessage(
        "The browser could not complete this analysis stage. Retry it safely.",
      );
    } finally {
      running.current = false;
    }
  }, [job.id, job.status, refreshJob, router]);

  useEffect(() => {
    if (!["QUEUED", "RUNNING"].includes(job.status)) return;
    const timeout = window.setTimeout(advance, 300);
    return () => window.clearTimeout(timeout);
  }, [advance, job.status, job.currentStage]);

  useEffect(() => {
    if (job.status !== "RUNNING") return;
    const poll = window.setInterval(() => {
      setNow(Date.now());
      void refreshJob();
    }, 3_000);
    return () => window.clearInterval(poll);
  }, [job.status, refreshJob]);

  const hasRecentHeartbeat =
    job.status === "RUNNING" &&
    Boolean(
      job.lastHeartbeatAt &&
      new Date(job.lastHeartbeatAt).getTime() > now - 8_000,
    );

  async function control(action: "retry" | "cancel") {
    setMessage(null);
    const response = await fetch(`/api/analysis-jobs/${job.id}/${action}`, {
      method: "POST",
    });
    const result = await response.json();
    if (result.ok) setJob(result.data);
    else setMessage(result.error.message);
  }

  return (
    <div
      className="mt-6 rounded-xl border border-blue-200 bg-blue-50/60 p-5"
      aria-live="polite"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-blue-950">
            {["QUEUED", "RUNNING"].includes(job.status) ? (
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                size={17}
              />
            ) : null}
            {job.status === "FAILED"
              ? "Analysis paused after a failed stage"
              : job.status === "RUNNING"
                ? hasRecentHeartbeat
                  ? "AI is responding"
                  : "Waiting for provider response"
                : `Running ${job.currentStage.replaceAll("_", " ").toLowerCase()}`}
          </p>
          <p className="mt-1 text-xs leading-5 text-blue-800">
            Response content is validated before it is saved or displayed.
            Closing this page does not lose completed work.
          </p>
        </div>
        <div className="flex gap-2">
          {job.status === "FAILED" ? (
            <Button onClick={() => control("retry")}>
              <RefreshCw size={16} /> Retry stage
            </Button>
          ) : null}
          {["QUEUED", "RUNNING"].includes(job.status) ? (
            <Button variant="outline" onClick={() => control("cancel")}>
              <Square size={15} /> Cancel
            </Button>
          ) : null}
        </div>
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-blue-100"
        role="progressbar"
        aria-label="Live analysis progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={job.progressPercent}
      >
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
          style={{ width: `${job.progressPercent}%` }}
        />
      </div>
      {message || job.errorMessage ? (
        <p className="mt-3 text-sm text-destructive">
          {message || job.errorMessage}
        </p>
      ) : null}
    </div>
  );
}
