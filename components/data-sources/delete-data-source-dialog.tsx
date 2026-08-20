"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { deleteDataSourceAction } from "@/features/data-sources/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function DeleteDataSourceDialog({
  dataSourceId,
  dataSourceName,
  linkedDashboards,
}: {
  dataSourceId: string;
  dataSourceName: string;
  linkedDashboards: number;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(deleteDataSourceAction, null);
  const fieldError =
    state && !state.ok
      ? state.error.fieldErrors?.confirmationName?.[0]
      : undefined;

  useEffect(() => {
    if (state?.ok) {
      dialogRef.current?.close();
      router.push("/workspace/data-sources");
      router.refresh();
    }
  }, [router, state]);

  return (
    <>
      <Button
        type="button"
        variant="destructive"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 size={17} />
        Delete data source
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby="delete-data-source-title"
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
              <h2 id="delete-data-source-title" className="font-semibold">
                Permanently delete data source?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                This action cannot be undone.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="grid size-11 cursor-pointer place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-45"
            onClick={() => dialogRef.current?.close()}
            disabled={pending}
            aria-label="Close delete confirmation"
          >
            <X size={19} />
          </button>
        </div>
        <form action={action} className="space-y-5 p-5">
          <input type="hidden" name="dataSourceId" value={dataSourceId} />
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            Credentials, uploaded-file metadata, discovered schemas, tables,
            columns, and relationships will be deleted. {linkedDashboards}{" "}
            linked dashboard{linkedDashboards === 1 ? "" : "s"} will be detached
            but retained with version history.
          </div>
          <Field
            label={`Enter “${dataSourceName}” to confirm`}
            htmlFor="confirmationName"
            error={fieldError}
            required
          >
            <Input
              id="confirmationName"
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
