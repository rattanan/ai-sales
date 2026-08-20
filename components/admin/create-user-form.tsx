"use client";

import { useActionState } from "react";
import { createUserAction } from "@/features/admin/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";

export function CreateUserForm({
  roles,
  organizationUnits,
  projects,
}: {
  roles: {
    id: string;
    name: string;
    description: string | null;
    systemKey: string | null;
  }[];
  organizationUnits: { id: string; name: string }[];
  projects: { id: string; name: string }[];
}) {
  const [state, action, pending] = useActionState(createUserAction, null);
  return (
    <form action={action} className="grid gap-5 md:grid-cols-2">
      <Field label="Full name" htmlFor="name" required>
        <Input id="name" name="name" required />
      </Field>
      <Field label="Email" htmlFor="email" required>
        <Input id="email" name="email" type="email" required />
      </Field>
      <Field label="Username" htmlFor="username" required>
        <Input id="username" name="username" autoComplete="off" required />
      </Field>
      <Field label="Role" htmlFor="roleId" required>
        <select
          id="roleId"
          name="roleId"
          className="min-h-11 w-full rounded-lg border bg-white px-3"
          required
        >
          <option value="">Select role</option>
          {roles.map((role) => (
            <option key={role.id} value={role.id}>
              {role.name}
              {role.description ? ` — ${role.description}` : ""}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Temporary password" htmlFor="temporaryPassword" required>
        <Input
          id="temporaryPassword"
          name="temporaryPassword"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <Field label="Account status" htmlFor="status" required>
        <select
          id="status"
          name="status"
          defaultValue="PENDING_ACTIVATION"
          className="min-h-11 w-full rounded-lg border bg-white px-3"
        >
          <option value="PENDING_ACTIVATION">Pending activation</option>
          <option value="ACTIVE">Active</option>
          <option value="LOCKED">Locked</option>
          <option value="DISABLED">Disabled</option>
        </select>
      </Field>
      <Field
        label="Department / organization unit"
        htmlFor="organizationUnitId"
      >
        <select
          id="organizationUnitId"
          name="organizationUnitId"
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
          className="min-h-28 w-full rounded-lg border bg-white px-3 py-2"
        >
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="forcePasswordChange" type="checkbox" defaultChecked />{" "}
        Force password change on first login
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="copilotEnabled" type="checkbox" /> Enable AI Copilot
      </label>
      <div className="md:col-span-2">
        {!state?.ok ? (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {state?.error.message}
          </p>
        ) : null}
        {state?.ok ? (
          <p role="status" className="mb-3 text-sm text-emerald-700">
            User created successfully.
          </p>
        ) : null}
        <Button disabled={pending}>
          {pending ? "Creating…" : "Create user"}
        </Button>
      </div>
    </form>
  );
}
