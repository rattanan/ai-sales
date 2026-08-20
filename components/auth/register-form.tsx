"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Eye, EyeOff, LoaderCircle } from "lucide-react";
import { registerAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function RegisterForm() {
  const [state, action, pending] = useActionState(registerAction, null);
  const [show, setShow] = useState(false);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;
  return (
    <form action={action} className="space-y-5">
      <Field
        label="Full name"
        htmlFor="name"
        required
        error={errors?.name?.[0]}
      >
        <Input id="name" name="name" autoComplete="name" required />
      </Field>
      <Field
        label="Work email"
        htmlFor="email"
        required
        error={errors?.email?.[0]}
      >
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
        />
      </Field>
      <Field
        label="Password"
        htmlFor="password"
        required
        hint="At least 12 characters with upper/lowercase letters and a number."
        error={errors?.password?.[0]}
      >
        <div className="relative">
          <Input
            id="password"
            name="password"
            type={show ? "text" : "password"}
            autoComplete="new-password"
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
      {state && !state.ok && !state.error.fieldErrors ? (
        <p className="text-sm text-destructive" role="alert">
          {state.error.message}
        </p>
      ) : null}
      <Button className="w-full" disabled={pending}>
        {pending ? <LoaderCircle className="animate-spin" size={18} /> : null}
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-semibold text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
