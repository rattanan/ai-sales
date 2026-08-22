"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { loginAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="space-y-5">
      <Field label="Email or username" htmlFor="identifier" required>
        <Input
          id="identifier"
          name="identifier"
          autoComplete="username"
          required
        />
      </Field>
      <div className="flex items-center justify-between gap-4 text-sm">
        <label className="flex min-h-11 cursor-pointer items-center gap-2">
          <input
            name="rememberMe"
            type="checkbox"
            className="size-4 rounded border-slate-300 accent-primary"
          />
          Remember me
        </label>
        <Link
          href="/forgot-password"
          className="font-medium text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </div>
      <Field label="Password" htmlFor="password" required>
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="current-password"
            className="pr-12"
            required
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 grid w-11 cursor-pointer place-items-center text-muted-foreground hover:text-foreground"
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
      </Field>
      {!state?.ok ? (
        <p className="text-sm text-destructive" role="alert" aria-live="polite">
          {state?.error.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" size={18} /> : null}
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Accounts are provisioned by your system administrator.
      </p>
    </form>
  );
}
