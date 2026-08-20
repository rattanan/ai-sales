"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, SearchCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reindexSourceWithFeedbackAction } from "@/features/knowledge/source-actions";

export function SourceReindexForm({
  sourceId,
  activeJobCount,
  reindexableJobCount,
  hasDocumentVersion,
}: {
  sourceId: string;
  activeJobCount: number;
  reindexableJobCount: number;
  hasDocumentVersion: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    reindexSourceWithFeedbackAction,
    null,
  );
  const indexingOnly = activeJobCount > 0 && reindexableJobCount === 0;

  useEffect(() => {
    if (!activeJobCount) return;
    const timer = window.setInterval(() => router.refresh(), 3_000);
    return () => window.clearInterval(timer);
  }, [activeJobCount, router]);

  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [router, state]);

  const message = state
    ? state.ok
      ? state.data.queued
        ? `${state.data.queued} document${state.data.queued === 1 ? "" : "s"} queued for indexing.`
        : "No completed or failed documents were available to re-index."
      : state.error.message
    : indexingOnly
      ? "Indexing is already in progress. This page refreshes automatically."
      : !hasDocumentVersion
        ? "Upload a document version before re-indexing."
        : undefined;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="id" value={sourceId} />
      <Button
        type="submit"
        variant="outline"
        className="w-full"
        disabled={pending || indexingOnly || !hasDocumentVersion}
      >
        {pending ? (
          <LoaderCircle className="animate-spin" size={16} aria-hidden="true" />
        ) : (
          <SearchCheck size={16} aria-hidden="true" />
        )}
        {pending
          ? "Queuing…"
          : indexingOnly
            ? "Indexing in progress"
            : "Re-index documents"}
      </Button>
      {message ? (
        <p
          role={state && !state.ok ? "alert" : "status"}
          aria-live="polite"
          className={
            state && !state.ok
              ? "text-xs text-destructive"
              : "text-xs text-muted-foreground"
          }
        >
          {message}
        </p>
      ) : null}
    </form>
  );
}
