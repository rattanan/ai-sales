"use client";

import { useActionState } from "react";
import {
  saveCopiedTextSourceAction,
  updateSourceAssignmentAction,
} from "@/features/knowledge/unified-source-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Choice = { id: string; name: string };
type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  return (
    <p
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={
        state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"
      }
    >
      {state.ok ? "Saved and queued for processing." : state.error.message}
    </p>
  );
}

export function CopiedTextSourceForm({
  racks,
  bots,
  value,
}: {
  racks: Choice[];
  bots: Choice[];
  value?: {
    id: string;
    rackId: string;
    name: string;
    description: string | null;
    content: string;
    category: string | null;
    tags: string[];
    scope: "GLOBAL" | "SELECTED_BOTS";
    botIds: string[];
  };
}) {
  const [state, action, pending] = useActionState(
    saveCopiedTextSourceAction,
    null,
  );
  return (
    <form action={action} className="grid gap-5 lg:grid-cols-2">
      {value ? <input type="hidden" name="sourceId" value={value.id} /> : null}
      <Field label="Source name" htmlFor="copied-source-name" required>
        <Input
          id="copied-source-name"
          name="name"
          defaultValue={value?.name}
          required
        />
      </Field>
      <Field label="Knowledge rack" htmlFor="copied-source-rack" required>
        <select
          id="copied-source-rack"
          name="rackId"
          defaultValue={value?.rackId ?? ""}
          required
          className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="">Select a governed rack</option>
          {racks.map((rack) => (
            <option key={rack.id} value={rack.id}>
              {rack.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Category" htmlFor="copied-source-category">
        <Input
          id="copied-source-category"
          name="category"
          defaultValue={value?.category ?? ""}
          placeholder="Policy, Product, Operations…"
        />
      </Field>
      <Field
        label="Tags"
        htmlFor="copied-source-tags"
        hint="Comma or line separated"
      >
        <Input
          id="copied-source-tags"
          name="tags"
          defaultValue={value?.tags.join(", ") ?? ""}
          placeholder="thai, policy, 2026"
        />
      </Field>
      <div className="lg:col-span-2">
        <Field label="Description" htmlFor="copied-source-description">
          <textarea
            id="copied-source-description"
            name="description"
            defaultValue={value?.description ?? ""}
            rows={2}
            className="w-full rounded-lg border bg-background p-3 text-sm"
          />
        </Field>
      </div>
      <div className="lg:col-span-2">
        <Field
          label="Content"
          htmlFor="copied-source-content"
          hint="Preview the text here before saving. Editing later creates a new document version and queues only this source."
          required
        >
          <textarea
            id="copied-source-content"
            name="content"
            defaultValue={value?.content}
            rows={12}
            minLength={20}
            className="w-full rounded-lg border bg-background p-3 text-sm leading-6"
            required
          />
        </Field>
      </div>
      <Field label="Scope" htmlFor="copied-source-scope">
        <select
          id="copied-source-scope"
          name="scope"
          defaultValue={value?.scope ?? "SELECTED_BOTS"}
          className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="SELECTED_BOTS">Selected bots</option>
          <option value="GLOBAL">Global within the actor&apos;s ACL</option>
        </select>
      </Field>
      <fieldset className="rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Assign bots</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {bots.map((bot) => (
            <label
              key={bot.id}
              className="flex min-h-11 items-center gap-2 text-sm"
            >
              <input
                type="checkbox"
                name="botIds"
                value={bot.id}
                defaultChecked={value?.botIds.includes(bot.id)}
              />{" "}
              {bot.name}
            </label>
          ))}
          {!bots.length ? (
            <p className="text-sm text-muted-foreground">
              Create a bot before using Selected Bots scope.
            </p>
          ) : null}
        </div>
      </fieldset>
      <div className="space-y-3 lg:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending}>
          {pending
            ? "Saving & queueing…"
            : value
              ? "Save new version & process"
              : "Save and process"}
        </Button>
      </div>
    </form>
  );
}

export function SourceAssignmentForm({
  source,
  bots,
}: {
  source: {
    id: string;
    type: "KNOWLEDGE" | "DATABASE" | "API_TOOL";
    scope: "GLOBAL" | "SELECTED_BOTS";
    enabled: boolean;
    botIds: string[];
    priority: number;
  };
  bots: Choice[];
}) {
  const [state, action, pending] = useActionState(
    updateSourceAssignmentAction,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="sourceId" value={source.id} />
      <input type="hidden" name="sourceType" value={source.type} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Scope" htmlFor={`scope-${source.type}-${source.id}`}>
          <select
            id={`scope-${source.type}-${source.id}`}
            name="scope"
            defaultValue={source.scope}
            className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="SELECTED_BOTS">Selected bots</option>
            <option value="GLOBAL">Global within ACL</option>
          </select>
        </Field>
        <Field
          label="Priority"
          htmlFor={`priority-${source.type}-${source.id}`}
        >
          <Input
            id={`priority-${source.type}-${source.id}`}
            name="priority"
            type="number"
            min="1"
            max="1000"
            defaultValue={source.priority}
          />
        </Field>
      </div>
      <fieldset>
        <legend className="text-sm font-medium">
          Bot assignments and overrides
        </legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {bots.map((bot) => (
            <label
              key={bot.id}
              className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
            >
              <input
                type="checkbox"
                name="botIds"
                value={bot.id}
                defaultChecked={source.botIds.includes(bot.id)}
              />{" "}
              {bot.name}
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={source.enabled} />{" "}
        Source enabled
      </label>
      <ActionMessage state={state} />
      <Button size="sm" variant="outline" disabled={pending}>
        {pending ? "Saving…" : "Save scope & assignments"}
      </Button>
    </form>
  );
}
