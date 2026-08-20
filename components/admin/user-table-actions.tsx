"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, LoaderCircle, Pencil, Trash2, X } from "lucide-react";
import {
  deleteUserAction,
  updateUserStatusAction,
} from "@/features/admin/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ManagedUser = {
  id: string;
  name: string | null;
  email: string;
  status: string;
};

export function UserTableActions({
  user,
  isCurrentUser,
  canEdit,
  canDisable,
  canDelete,
}: {
  user: ManagedUser;
  isCurrentUser: boolean;
  canEdit: boolean;
  canDisable: boolean;
  canDelete: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {canEdit ? (
        <Button asChild size="sm" variant="outline" className="min-h-11">
          <Link href={`/workspace/admin/users/${user.id}`}>
            <Pencil size={15} /> Edit
          </Link>
        </Button>
      ) : null}
      {canDisable && !isCurrentUser ? (
        <form action={updateUserStatusAction}>
          <input type="hidden" name="userId" value={user.id} />
          <input
            type="hidden"
            name="status"
            value={user.status === "ACTIVE" ? "DISABLED" : "ACTIVE"}
          />
          <Button
            type="submit"
            size="sm"
            variant="outline"
            className="min-h-11"
          >
            {user.status === "ACTIVE" ? "Disable" : "Enable"}
          </Button>
        </form>
      ) : null}
      {canDelete && !isCurrentUser ? <DeleteUserDialog user={user} /> : null}
    </div>
  );
}

export function DeleteUserDialog({ user }: { user: ManagedUser }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [state, action, pending] = useActionState(deleteUserAction, null);
  const fieldError =
    state && !state.ok
      ? state.error.fieldErrors?.confirmationEmail?.[0]
      : undefined;

  useEffect(() => {
    if (state?.ok) {
      dialogRef.current?.close();
      router.push("/workspace/admin/users");
      router.refresh();
    }
  }, [router, state]);

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="min-h-11"
        onClick={() => dialogRef.current?.showModal()}
      >
        <Trash2 size={15} /> Delete
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={`delete-user-title-${user.id}`}
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
              <h2 id={`delete-user-title-${user.id}`} className="font-semibold">
                Delete user account?
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {user.name ?? user.email} will immediately lose access.
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
          <input type="hidden" name="userId" value={user.id} />
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm leading-6 text-red-900">
            The account will be soft-deleted and all active sessions will be
            invalidated. Audit history is retained.
          </div>
          <Field
            label={`Enter “${user.email}” to confirm`}
            htmlFor={`delete-user-email-${user.id}`}
            error={fieldError}
            required
          >
            <Input
              id={`delete-user-email-${user.id}`}
              name="confirmationEmail"
              type="email"
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
              {pending ? "Deleting…" : "Delete account"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
