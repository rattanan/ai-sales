"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  deleteKnowledgeFolderAction,
  deleteKnowledgeSourceAction,
} from "@/features/knowledge/delete-actions";

export function DeleteKnowledgeDialog({
  kind,
  resourceId,
  resourceName,
  sourceCount = 0,
  documentCount = 0,
  redirectTo,
  compact = false,
}: {
  kind: "source" | "folder";
  resourceId: string;
  resourceName: string;
  sourceCount?: number;
  documentCount?: number;
  redirectTo?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const deleteAction =
    kind === "folder"
      ? deleteKnowledgeFolderAction
      : deleteKnowledgeSourceAction;
  const [state, action, pending] = useActionState(deleteAction, null);
  const titleId = `delete-${kind}-${resourceId}-title`;
  const descriptionId = `delete-${kind}-${resourceId}-description`;
  const inputId = `delete-${kind}-${resourceId}-confirmation`;
  const blockedDescriptionId = `delete-${kind}-${resourceId}-blocked`;
  const folderHasDocuments = kind === "folder" && documentCount > 0;
  const fieldError =
    state && !state.ok
      ? state.error.fieldErrors?.confirmationName?.[0]
      : undefined;

  useEffect(() => {
    if (!state?.ok) return;
    dialogRef.current?.close();
    if (redirectTo) router.push(redirectTo);
    router.refresh();
  }, [redirectTo, router, state]);

  const label = kind === "folder" ? "folder" : "source";

  return (
    <>
      {compact ? (
        <span
          className="inline-flex shrink-0"
          title={
            folderHasDocuments
              ? "Remove all documents before deleting this folder"
              : `Delete folder ${resourceName}`
          }
        >
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="size-9 min-h-9 p-0 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            onClick={() => dialogRef.current?.showModal()}
            disabled={folderHasDocuments}
            aria-label={`Delete folder ${resourceName}`}
            aria-describedby={
              folderHasDocuments ? blockedDescriptionId : undefined
            }
          >
            <Trash2 size={17} aria-hidden="true" />
          </Button>
          {folderHasDocuments ? (
            <span id={blockedDescriptionId} className="sr-only">
              This folder contains documents. Remove all documents before
              deleting the folder.
            </span>
          ) : null}
        </span>
      ) : (
        <Button
          type="button"
          variant="destructive"
          onClick={() => dialogRef.current?.showModal()}
        >
          <Trash2 size={17} aria-hidden="true" />
          Delete {label}
        </Button>
      )}
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/55"
      >
        <div className="flex items-start justify-between border-b p-5">
          <div className="flex gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-red-50 text-destructive">
              <AlertTriangle size={20} aria-hidden="true" />
            </span>
            <div>
              <h2 id={titleId} className="font-semibold">
                Permanently delete this {label}?
              </h2>
              <p
                id={descriptionId}
                className="mt-1 text-sm text-muted-foreground"
              >
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
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        <form action={action} className="space-y-5 p-5">
          <input type="hidden" name="id" value={resourceId} />
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            {kind === "folder" ? (
              <>
                This will delete <strong>{sourceCount}</strong> source
                {sourceCount === 1 ? "" : "s"} and all documents, index data,
                refresh history, and access assignments inside the folder.
              </>
            ) : (
              <>
                This will delete <strong>{documentCount}</strong> document
                {documentCount === 1 ? "" : "s"}, index data, refresh history,
                and access assignments for this source.
              </>
            )}
          </div>
          <Field
            label={`Enter “${resourceName}” to confirm`}
            htmlFor={inputId}
            error={fieldError}
            required
          >
            <Input
              id={inputId}
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
                <Trash2 size={17} aria-hidden="true" />
              )}
              {pending ? "Deleting…" : "Delete permanently"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
