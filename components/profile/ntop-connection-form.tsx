"use client";

import { useActionState } from "react";
import { updateNtopApiKeyAction } from "@/features/auth/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function NtopConnectionForm({
  prefix,
  updatedAt,
}: {
  prefix: string | null;
  updatedAt: string | null;
}) {
  const [state, action, pending] = useActionState(updateNtopApiKeyAction, null);
  return (
    <form action={action} className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-3 text-sm">
        <p className="font-medium">
          {prefix ? `Connected as ntop_${prefix}_••••` : "Not connected"}
        </p>
        <p className="mt-1 text-muted-foreground">
          {updatedAt
            ? `Key updated ${new Date(updatedAt).toLocaleString()}`
            : "Ask an NTOP administrator to create your user and copy the one-time API Key."}
        </p>
      </div>
      <Field
        label={prefix ? "Replace NTOP API Key" : "NTOP API Key"}
        htmlFor="ntopApiKey"
        required
      >
        <Input
          id="ntopApiKey"
          name="ntopApiKey"
          type="password"
          autoComplete="new-password"
          aria-describedby="ntop-api-key-help"
          required
        />
      </Field>
      <p id="ntop-api-key-help" className="text-sm text-muted-foreground">
        Stored encrypted and used only by the AI-Sales backend. Replacing it
        changes the identity used for future NTOP Chat actions.
      </p>
      {state ? (
        <p
          role={state.ok ? "status" : "alert"}
          aria-live="polite"
          className={`text-sm ${state.ok ? "text-emerald-700" : "text-destructive"}`}
        >
          {state.ok
            ? "NTOP API Key saved. Future records will be owned by this NTOP user."
            : state.error.message}
        </p>
      ) : null}
      <Button disabled={pending}>
        {pending ? "Saving…" : prefix ? "Replace API Key" : "Connect NTOP"}
      </Button>
    </form>
  );
}
