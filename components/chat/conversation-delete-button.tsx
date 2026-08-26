"use client";

import { useRef, useState, useTransition } from "react";
import { AlertTriangle, LoaderCircle, Trash2, X } from "lucide-react";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { Button } from "@/components/ui/button";
import { deleteConversationAction } from "@/features/chat/actions";

export function ConversationDeleteButton({
  conversationId,
  conversationTitle,
  onDeleted,
}: {
  conversationId: string;
  conversationTitle: string;
  onDeleted?: () => void;
}) {
  const { t } = useWorkspaceLocale();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const titleId = `delete-conversation-${conversationId}-title`;
  const descriptionId = `delete-conversation-${conversationId}-description`;
  const buttonLabel = `${t("Delete conversation")}: ${conversationTitle}`;

  function openDialog() {
    setError("");
    if (!dialogRef.current?.open) dialogRef.current?.showModal();
  }

  function closeDialog() {
    if (!pending) dialogRef.current?.close();
  }

  function removeConversation() {
    const formData = new FormData();
    formData.set("conversationId", conversationId);
    setError("");

    startTransition(async () => {
      try {
        await deleteConversationAction(formData);
        dialogRef.current?.close();
        onDeleted?.();
      } catch {
        setError(t("Could not delete the conversation. Try again."));
      }
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="my-auto mr-1 shrink-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={openDialog}
        aria-label={buttonLabel}
        title={buttonLabel}
      >
        <Trash2 size={17} aria-hidden="true" />
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={pending}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        onClose={() => setError("")}
        className="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border bg-card p-0 text-foreground shadow-2xl backdrop:bg-slate-950/55"
      >
        <div className="flex items-start justify-between gap-4 border-b p-5">
          <div className="flex min-w-0 gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-destructive/10 text-destructive">
              <AlertTriangle size={20} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h2 id={titleId} className="font-semibold">
                {t("Delete this conversation?")}
              </h2>
              <p
                id={descriptionId}
                className="mt-1 text-sm leading-6 text-muted-foreground"
              >
                {t(
                  "This conversation and its messages will be removed from your history. This action cannot be undone.",
                )}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="-mr-2 -mt-2 shrink-0"
            onClick={closeDialog}
            disabled={pending}
            aria-label={t("Close delete confirmation")}
          >
            <X size={19} aria-hidden="true" />
          </Button>
        </div>
        <div className="p-5">
          <p className="truncate rounded-lg bg-muted px-3 py-2 text-sm font-medium">
            {conversationTitle}
          </p>
          {error ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <div className="mt-5 flex flex-col-reverse gap-3 border-t pt-5 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={closeDialog}
            >
              {t("Cancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={removeConversation}
            >
              {pending ? (
                <LoaderCircle
                  size={18}
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <Trash2 size={17} aria-hidden="true" />
              )}
              {pending ? t("Deleting…") : t("Delete conversation")}
            </Button>
          </div>
        </div>
      </dialog>
    </>
  );
}
