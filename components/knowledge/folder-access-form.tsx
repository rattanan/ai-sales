"use client";

import { useActionState } from "react";
import { updateKnowledgeFolderAccessAction } from "@/features/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

export function FolderAccessForm({
  folder,
  bots,
}: {
  folder: {
    id: string;
    scope: "GLOBAL" | "SELECTED_BOTS";
    botIds: string[];
  };
  bots: Array<{ id: string; name: string }>;
}) {
  const [state, action, pending] = useActionState(
    updateKnowledgeFolderAccessAction,
    null,
  );
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="rackId" value={folder.id} />
      <Field label="Folder access" htmlFor={`folder-scope-${folder.id}`}>
        <select
          id={`folder-scope-${folder.id}`}
          name="scope"
          defaultValue={folder.scope}
          className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
        >
          <option value="GLOBAL">Shared — every bot can access</option>
          <option value="SELECTED_BOTS">Specific bots only</option>
        </select>
      </Field>
      <fieldset>
        <legend className="text-sm font-medium">Bots with folder access</legend>
        <p className="mt-1 text-xs text-muted-foreground">
          Used when “Specific bots only” is selected. Source-level settings can
          further narrow or share individual sources.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => (
            <label
              key={bot.id}
              className="flex min-h-11 items-center gap-2 rounded-lg border bg-white px-3 text-sm"
            >
              <input
                type="checkbox"
                name="botIds"
                value={bot.id}
                defaultChecked={folder.botIds.includes(bot.id)}
              />
              <span className="truncate">{bot.name}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          className={
            state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"
          }
        >
          {state.ok ? "Folder access saved." : state.error.message}
        </p>
      ) : null}
      <Button size="sm" disabled={pending}>
        {pending ? "Saving…" : "Save folder access"}
      </Button>
    </form>
  );
}
