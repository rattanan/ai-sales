"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  changePasswordAction,
  forgotPasswordAction,
  resetPasswordAction,
} from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

function ResultMessage({
  state,
}: {
  state: { ok: boolean; error?: { message: string } } | null;
}) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={
        state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"
      }
    >
      {state.ok ? "Request completed successfully." : state.error?.message}
    </p>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(forgotPasswordAction, null);
  return (
    <form action={action} className="space-y-5">
      <Field label="Registered email" htmlFor="email" required>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      <ResultMessage state={state} />
      {state?.ok && state.data.developmentResetUrl ? (
        <Link
          className="block text-sm font-medium text-primary hover:underline"
          href={state.data.developmentResetUrl}
        >
          Open development reset link
        </Link>
      ) : null}
      <Button className="w-full" disabled={pending}>
        {pending ? "Submitting…" : "Send reset instructions"}
      </Button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPasswordAction, null);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" required>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <ResultMessage state={state} />
      {state?.ok ? (
        <Link
          href="/login"
          className="text-sm font-medium text-primary hover:underline"
        >
          Continue to sign in
        </Link>
      ) : null}
      <Button className="w-full" disabled={pending || state?.ok}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-5">
      <Field label="Temporary password" htmlFor="currentPassword" required>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="New password" htmlFor="password" required>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field label="Confirm password" htmlFor="confirmPassword" required>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <p className="text-xs leading-5 text-muted-foreground">
        Use at least 12 characters with upper and lowercase letters and a
        number.
      </p>
      <ResultMessage state={state} />
      <Button className="w-full" disabled={pending}>
        {pending ? "Updating…" : "Set new password"}
      </Button>
    </form>
  );
}
