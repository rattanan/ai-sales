"use client";

import { useActionState } from "react";
import {
  resetUserPasswordAction,
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

export function ResetUserPasswordForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(
    resetUserPasswordAction,
    null,
  );
  return (
    <form
      action={action}
      className="flex flex-col gap-3 sm:flex-row sm:items-end"
    >
      <input type="hidden" name="userId" value={userId} />
      <Field label="New temporary password" htmlFor="temporaryPassword">
        <Input
          id="temporaryPassword"
          name="temporaryPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Button disabled={pending}>
        {pending ? "Resetting…" : "Reset password"}
      </Button>
      {state ? (
        <p
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-destructive"}`}
        >
          {state.ok
            ? "Password reset; all sessions invalidated."
            : state.error.message}
        </p>
      ) : null}
    </form>
  );
}
