"use client";

import { useActionState } from "react";
import {
  changeMemoryConsentAction,
  deleteAllUserMemoriesAction,
  saveUserMemoryAction,
} from "@/features/memory/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;

type Choice = { id: string; name: string };
type MemoryValue = {
  id: string;
  botId: string | null;
  category: "PREFERENCE" | "DEPARTMENT" | "PROJECT";
  key: string;
  value: string;
};

function Status({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"}
    >
      {state.ok ? "Saved successfully." : state.error.message}
    </p>
  );
}

export function MemoryForm({
  bots,
  memory,
}: {
  bots: Choice[];
  memory?: MemoryValue;
}) {
  const [state, action, pending] = useActionState(saveUserMemoryAction, null);
  const suffix = memory?.id ?? "new";
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {memory ? <input type="hidden" name="id" value={memory.id} /> : null}
      <Field label="Bot scope" htmlFor={`memory-bot-${suffix}`}>
        <select
          id={`memory-bot-${suffix}`}
          name="botId"
          defaultValue={memory?.botId ?? ""}
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="">All consented bots</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Category" htmlFor={`memory-category-${suffix}`}>
        <select
          id={`memory-category-${suffix}`}
          name="category"
          defaultValue={memory?.category ?? "PREFERENCE"}
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="PREFERENCE">Preference</option>
          <option value="DEPARTMENT">Department</option>
          <option value="PROJECT">Project</option>
        </select>
      </Field>
      <Field label="Memory key" htmlFor={`memory-key-${suffix}`} required>
        <Input
          id={`memory-key-${suffix}`}
          name="key"
          defaultValue={memory?.key}
          placeholder="response_style"
          required
        />
      </Field>
      <Field
        label="Memory value"
        htmlFor={`memory-value-${suffix}`}
        hint="Department and project values must match your assigned scope. Sensitive values are rejected."
        required
      >
        <Input
          id={`memory-value-${suffix}`}
          name="value"
          defaultValue={memory?.value}
          placeholder="Concise Thai summaries"
          required
        />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <Status state={state} />
        <Button disabled={pending}>
          {pending ? "Saving…" : memory ? "Update memory" : "Add memory"}
        </Button>
      </div>
    </form>
  );
}

export function MemoryConsentForm({ bots }: { bots: Choice[] }) {
  const [state, action, pending] = useActionState(
    changeMemoryConsentAction,
    null,
  );
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Bot scope" htmlFor="consent-bot">
        <select
          id="consent-bot"
          name="botId"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="">All assigned bots</option>
          {bots.map((bot) => (
            <option key={bot.id} value={bot.id}>
              {bot.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Consent decision" htmlFor="consent-status">
        <select
          id="consent-status"
          name="status"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="GRANTED">Grant consent</option>
          <option value="REVOKED">Revoke and delete selected memories</option>
        </select>
      </Field>
      <fieldset className="space-y-2 md:col-span-2">
        <legend className="text-sm font-medium">Consented categories</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {[
            ["PREFERENCE", "Preferences"],
            ["DEPARTMENT", "Department"],
            ["PROJECT", "Projects"],
          ].map(([value, label]) => (
            <label
              key={value}
              className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm"
            >
              <input name="categories" type="checkbox" value={value} />
              {label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="md:col-span-2">
        <Field label="Reason or note" htmlFor="consent-reason">
          <textarea
            id="consent-reason"
            name="reason"
            rows={3}
            className="w-full rounded-lg border bg-background p-3 text-sm"
          />
        </Field>
      </div>
      <div className="space-y-3 md:col-span-2">
        <Status state={state} />
        <Button disabled={pending}>
          {pending ? "Saving decision…" : "Record consent decision"}
        </Button>
      </div>
    </form>
  );
}

export function DeleteAllMemoriesForm() {
  return (
    <form action={deleteAllUserMemoriesAction} className="space-y-3">
      <Field
        label='Type "DELETE ALL MEMORIES" to confirm'
        htmlFor="delete-all-memory-confirm"
      >
        <Input id="delete-all-memory-confirm" name="confirm" required />
      </Field>
      <Button variant="destructive">Delete all memories now</Button>
    </form>
  );
}
