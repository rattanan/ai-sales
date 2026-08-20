"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bot,
  LoaderCircle,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  analyzeDashboardAction,
  deleteDashboardAction,
} from "@/features/dashboards/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function DashboardActions({
  dashboard,
  canEdit,
  canAnalyze,
  canDelete,
  compact = false,
}: {
  dashboard: {
    id: string;
    name: string;
    status: string;
    dataSourceId?: string;
  };
  canEdit: boolean;
  canAnalyze: boolean;
  canDelete: boolean;
  compact?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {canEdit && dashboard.dataSourceId ? (
        <Button
          asChild
          size={compact ? "sm" : "default"}
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
        >
          <Link href={`/workspace/dashboards/${dashboard.id}/edit`}>
            <Pencil size={16} />
            Edit
          </Link>
        </Button>
      ) : null}
      {canAnalyze ? (
        dashboard.status === "ANALYZING" ? (
          <Button asChild size={compact ? "sm" : "default"}>
            <Link href={`/workspace/dashboards/${dashboard.id}/analysis`}>
              <Bot size={16} />
              View analysis
            </Link>
          </Button>
        ) : (
          <AnalyzeDashboardButton
            dashboardId={dashboard.id}
            reanalysis={dashboard.status !== "DRAFT"}
            compact={compact}
          />
        )
      ) : null}
      {canDelete ? (
        <DeleteDashboardDialog dashboard={dashboard} compact={compact} />
      ) : null}
    </div>
  );
}

function AnalyzeDashboardButton({
  dashboardId,
  reanalysis,
  compact,
}: {
  dashboardId: string;
  reanalysis: boolean;
  compact: boolean;
}) {
  const [state, action, pending] = useActionState(analyzeDashboardAction, null);
  return (
    <form action={action}>
      <input type="hidden" name="dashboardId" value={dashboardId} />
      <Button
        type="submit"
        size={compact ? "sm" : "default"}
        disabled={pending}
      >
        {pending ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}
        {pending ? "Starting…" : reanalysis ? "Re-analyze" : "Analyze"}
      </Button>
      {state && !state.ok ? (
        <p
          className="mt-2 max-w-64 text-xs leading-5 text-destructive"
          role="alert"
        >
          {state.error.message}
        </p>
      ) : null}
    </form>
  );
}

function DeleteDashboardDialog({
  dashboard,
  compact,
}: {
  dashboard: { id: string; name: string; status: string };
  compact: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(deleteDashboardAction, null);
  const fieldError =
    state && !state.ok
      ? state.error.fieldErrors?.confirmationName?.[0]
      : undefined;

  useEffect(() => {
    if (state?.ok) {
      dialogRef.current?.close();
      router.push("/workspace/dashboards");
      router.refresh();
    }
  }, [router, state]);

  return (
    <>
      <Button
        type="button"
        size={compact ? "sm" : "default"}
        variant="ghost"
        className="text-muted-foreground hover:bg-red-50 hover:text-destructive"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 size={16} />
        Delete
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`delete-dashboard-title-${dashboard.id}`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/55"
      >
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-50 text-destructive">
              <AlertTriangle size={20} />
            </span>
            <div>
              <h2
                id={`delete-dashboard-title-${dashboard.id}`}
                className="font-semibold"
              >
                Permanently delete dashboard?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="grid size-11 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted disabled:opacity-45"
            onClick={() => dialogRef.current?.close()}
            disabled={pending}
            aria-label="Close delete confirmation"
          >
            <X size={19} />
          </button>
        </div>
        <form action={action} className="space-y-5 p-5">
          <input type="hidden" name="dashboardId" value={dashboard.id} />
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            Widgets, versions, access grants, AI recommendations, generated
            queries, and analysis history belonging to this dashboard will be
            permanently deleted.
          </div>
          <Field
            label={`Enter “${dashboard.name}” to confirm`}
            htmlFor={`dashboard-confirmation-${dashboard.id}`}
            error={fieldError}
            required
          >
            <Input
              id={`dashboard-confirmation-${dashboard.id}`}
              name="confirmationName"
              autoComplete="off"
              disabled={pending}
              required
            />
          </Field>
          {state && !state.ok && !fieldError ? (
            <p className="text-sm text-destructive" role="alert">
              {state.error.message}
            </p>
          ) : null}
          <div className="flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => dialogRef.current?.close()}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending ? (
                <LoaderCircle size={18} className="animate-spin" />
              ) : (
                <Trash2 size={17} />
              )}
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
