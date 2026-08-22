"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  setUserPasswordAction,
  updateUserAction,
} from "@/features/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function EditUserForm({
  user,
  organizationUnits,
  projects,
}: {
  user: {
    id: string;
    name: string | null;
    email: string;
    username: string | null;
    copilotEnabled: boolean;
    organizationUnitId: string | null;
    projectIds: string[];
    ntopApiKeyPrefix: string | null;
    ntopApiKeyUpdatedAt: string | null;
  };
  organizationUnits: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(updateUserAction, null);
  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={user.id} />
      <Field label="Full name" htmlFor="name">
        <Input id="name" name="name" defaultValue={user.name ?? ""} required />
      </Field>
      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          defaultValue={user.email}
          required
        />
      </Field>
      <Field label="Username" htmlFor="username">
        <Input
          id="username"
          name="username"
          defaultValue={user.username ?? ""}
          required
        />
      </Field>
      <Field
        label="Department / organization unit"
        htmlFor="organizationUnitId"
      >
        <select
          id="organizationUnitId"
          name="organizationUnitId"
          defaultValue={user.organizationUnitId ?? ""}
          className="min-h-11 w-full rounded-lg border bg-white px-3"
        >
          <option value="">Unassigned</option>
          {organizationUnits.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Projects" htmlFor="projectIds">
        <select
          id="projectIds"
          name="projectIds"
          multiple
          defaultValue={user.projectIds}
          className="min-h-28 w-full rounded-lg border bg-white px-3 py-2"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex min-h-11 items-center gap-2 pt-6 text-sm">
        <input
          name="copilotEnabled"
          type="checkbox"
          defaultChecked={user.copilotEnabled}
        />{" "}
        Enable AI Copilot
      </label>
      <Field label="Replace NTOP API Key (optional)" htmlFor="ntopApiKey">
        <Input
          id="ntopApiKey"
          name="ntopApiKey"
          type="password"
          autoComplete="new-password"
          aria-describedby="edit-ntop-api-key-help"
        />
        <p
          id="edit-ntop-api-key-help"
          className="mt-1 text-xs text-muted-foreground"
        >
          {user.ntopApiKeyPrefix
            ? `Current: ntop_${user.ntopApiKeyPrefix}_••••${user.ntopApiKeyUpdatedAt ? ` · updated ${new Date(user.ntopApiKeyUpdatedAt).toLocaleString()}` : ""}. Leave blank to keep it.`
            : "Not connected. Leave blank so the user can connect from Profile."}
        </p>
      </Field>
      <div className="sm:col-span-2">
        {!state?.ok ? (
          <p className="mb-2 text-sm text-destructive">
            {state?.error.message}
          </p>
        ) : null}
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}

export function SetUserPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(setUserPasswordAction, null);
  const formRef = useRef<HTMLFormElement>(null);
  const errors = state && !state.ok ? state.error.fieldErrors : undefined;

  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);

  return (
    <form ref={formRef} action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="userId" value={userId} />
      <Field
        label="New password"
        htmlFor="adminPassword"
        hint="At least 12 characters with upper/lowercase letters and a number."
        error={errors?.password?.[0]}
        required
      >
        <Input
          id="adminPassword"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field
        label="Confirm password"
        htmlFor="adminConfirmPassword"
        error={errors?.confirmPassword?.[0]}
        required
      >
        <Input
          id="adminConfirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
        <input name="forcePasswordChange" type="checkbox" />
        Require the user to change this password at next sign-in
      </label>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button disabled={pending}>
          {pending ? "Setting…" : "Set password"}
        </Button>
        {state ? (
          <p
            role={state.ok ? "status" : "alert"}
            className={`text-sm ${state.ok ? "text-emerald-700" : "text-destructive"}`}
          >
            {state.ok
              ? "Password set; all existing sessions were signed out."
              : state.error.message}
          </p>
        ) : null}
      </div>
    </form>
  );
}
