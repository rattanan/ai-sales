"use client";

import { useActionState } from "react";
import {
  createOrganizationScopeAction,
  saveLlmProviderAction,
  savePrivacyPolicyAction,
  testLlmProviderAction,
} from "@/features/admin/config-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  const successMessage =
    state.ok &&
    state.data &&
    typeof state.data === "object" &&
    "message" in state.data &&
    typeof state.data.message === "string"
      ? state.data.message
      : "Saved successfully.";
  return (
    <p
      role={state.ok ? "status" : "alert"}
      className={
        state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"
      }
    >
      {state.ok ? successMessage : state.error.message}
    </p>
  );
}

export function OrganizationScopeForm({ kind }: { kind: "unit" | "project" }) {
  const [state, action, pending] = useActionState(
    createOrganizationScopeAction,
    null,
  );
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="kind" value={kind} />
      <Field label="Name" htmlFor={`${kind}-name`} required>
        <Input id={`${kind}-name`} name="name" required />
      </Field>
      <Field label="Code" htmlFor={`${kind}-code`} required>
        <Input id={`${kind}-code`} name="code" required placeholder="OPS" />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Description" htmlFor={`${kind}-description`}>
          <Input id={`${kind}-description`} name="description" />
        </Field>
      </div>
      <ActionMessage state={state} />
      <div className="sm:col-span-2">
        <Button disabled={pending}>
          {pending ? "Creating…" : `Create ${kind}`}
        </Button>
      </div>
    </form>
  );
}

type ProviderFormValue = {
  id: string;
  name: string;
  baseUrl: string;
  chatModel: string;
  embeddingModel: string;
  temperature: number;
  timeoutMs: number;
  maxTokens: number;
  active: boolean;
  supportsJsonSchema: boolean;
  fallbackEnabled: boolean;
  hasApiKey: boolean;
};

export function LlmProviderForm({
  provider,
}: {
  provider?: ProviderFormValue;
}) {
  const [state, action, pending] = useActionState(saveLlmProviderAction, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      {provider ? (
        <input type="hidden" name="providerId" value={provider.id} />
      ) : null}
      <Field
        label="Configuration name"
        htmlFor={`name-${provider?.id ?? "new"}`}
        required
      >
        <Input
          id={`name-${provider?.id ?? "new"}`}
          name="name"
          defaultValue={provider?.name}
          required
        />
      </Field>
      <Field
        label="Base URL"
        htmlFor={`base-${provider?.id ?? "new"}`}
        required
      >
        <Input
          id={`base-${provider?.id ?? "new"}`}
          name="baseUrl"
          type="url"
          defaultValue={provider?.baseUrl ?? "https://api.openai.com/v1"}
          required
        />
      </Field>
      <Field
        label="Chat model"
        htmlFor={`chat-${provider?.id ?? "new"}`}
        required
      >
        <Input
          id={`chat-${provider?.id ?? "new"}`}
          name="chatModel"
          defaultValue={provider?.chatModel}
          required
        />
      </Field>
      <Field
        label="Embedding model"
        htmlFor={`embedding-${provider?.id ?? "new"}`}
        required
      >
        <Input
          id={`embedding-${provider?.id ?? "new"}`}
          name="embeddingModel"
          defaultValue={provider?.embeddingModel}
          required
        />
      </Field>
      <Field
        label={
          provider?.hasApiKey
            ? "API key (leave blank to keep ••••••••)"
            : "API key"
        }
        htmlFor={`key-${provider?.id ?? "new"}`}
        required={!provider?.hasApiKey}
      >
        <Input
          id={`key-${provider?.id ?? "new"}`}
          name="apiKey"
          type="password"
          autoComplete="new-password"
          required={!provider?.hasApiKey}
        />
      </Field>
      <Field
        label="Temperature"
        htmlFor={`temperature-${provider?.id ?? "new"}`}
      >
        <Input
          id={`temperature-${provider?.id ?? "new"}`}
          name="temperature"
          type="number"
          min="0"
          max="2"
          step="0.1"
          defaultValue={provider?.temperature ?? 0.1}
          required
        />
      </Field>
      <Field label="Timeout (ms)" htmlFor={`timeout-${provider?.id ?? "new"}`}>
        <Input
          id={`timeout-${provider?.id ?? "new"}`}
          name="timeoutMs"
          type="number"
          min="1000"
          max="300000"
          defaultValue={provider?.timeoutMs ?? 30000}
          required
        />
      </Field>
      <Field label="Maximum tokens" htmlFor={`tokens-${provider?.id ?? "new"}`}>
        <Input
          id={`tokens-${provider?.id ?? "new"}`}
          name="maxTokens"
          type="number"
          min="128"
          defaultValue={provider?.maxTokens ?? 4096}
          required
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          name="active"
          type="checkbox"
          defaultChecked={provider?.active}
        />{" "}
        Active provider
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          name="supportsJsonSchema"
          type="checkbox"
          defaultChecked={provider?.supportsJsonSchema ?? true}
        />{" "}
        Supports JSON Schema
      </label>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          name="fallbackEnabled"
          type="checkbox"
          defaultChecked={provider?.fallbackEnabled}
        />{" "}
        Use as fallback when the active provider circuit is open
      </label>
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending}>
          {pending ? "Saving…" : provider ? "Save provider" : "Add provider"}
        </Button>
      </div>
    </form>
  );
}

export function ProviderTestButton({ providerId }: { providerId: string }) {
  const [state, action, pending] = useActionState(testLlmProviderAction, null);
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <input type="hidden" name="providerId" value={providerId} />
      <Button variant="outline" disabled={pending}>
        {pending ? "Testing chat + embeddings…" : "Test connection"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

export function PrivacyPolicyForm({
  policy,
}: {
  policy: {
    enabled: boolean;
    maskEmail: boolean;
    maskPhone: boolean;
    maskNationalId: boolean;
    maskFinancialAccount: boolean;
    maskPassport: boolean;
    maskHealth: boolean;
    maskReligion: boolean;
    maskBiometric: boolean;
    customMaskTerms: string[];
    allowSensitiveAiAccess: boolean;
    auditLogDays: number;
    loginHistoryDays: number;
    chatHistoryDays: number;
    memoryRetentionDays: number;
  };
}) {
  const [state, action, pending] = useActionState(
    savePrivacyPolicyAction,
    null,
  );
  const toggles = [
    ["enabled", "Enable PII masking", policy.enabled],
    ["maskEmail", "Mask email addresses", policy.maskEmail],
    ["maskPhone", "Mask phone numbers", policy.maskPhone],
    ["maskNationalId", "Mask national IDs", policy.maskNationalId],
    [
      "maskFinancialAccount",
      "Mask financial accounts",
      policy.maskFinancialAccount,
    ],
    ["maskPassport", "Mask passport numbers", policy.maskPassport],
    ["maskHealth", "Mask health and diagnosis data", policy.maskHealth],
    ["maskReligion", "Mask religion and belief data", policy.maskReligion],
    ["maskBiometric", "Mask biometric identifiers", policy.maskBiometric],
    [
      "allowSensitiveAiAccess",
      "Allow approved sensitive AI access",
      policy.allowSensitiveAiAccess,
    ],
  ] as const;
  return (
    <form action={action} className="grid gap-5 md:grid-cols-2">
      <div className="space-y-3">
        {toggles.map(([name, label, checked]) => (
          <label
            key={name}
            className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm"
          >
            <input name={name} type="checkbox" defaultChecked={checked} />{" "}
            {label}
          </label>
        ))}
      </div>
      <div className="grid gap-3">
        <Field
          label="Organization policy labels"
          htmlFor="customMaskTerms"
          hint="One label per line. Values written after that label and a colon/equal sign are masked before external AI calls."
        >
          <textarea
            id="customMaskTerms"
            name="customMaskTerms"
            rows={5}
            defaultValue={policy.customMaskTerms.join("\n")}
            className="w-full rounded-lg border bg-background p-3 text-sm"
            placeholder={"employee classification\nระดับความลับ"}
          />
        </Field>
        <Field label="Audit log retention (days)" htmlFor="auditLogDays">
          <Input
            id="auditLogDays"
            name="auditLogDays"
            type="number"
            min="30"
            max="3650"
            defaultValue={policy.auditLogDays}
            required
          />
        </Field>
        <Field
          label="Login history retention (days)"
          htmlFor="loginHistoryDays"
        >
          <Input
            id="loginHistoryDays"
            name="loginHistoryDays"
            type="number"
            min="30"
            max="3650"
            defaultValue={policy.loginHistoryDays}
            required
          />
        </Field>
        <Field label="Chat history retention (days)" htmlFor="chatHistoryDays">
          <Input
            id="chatHistoryDays"
            name="chatHistoryDays"
            type="number"
            min="1"
            max="3650"
            defaultValue={policy.chatHistoryDays}
            required
          />
        </Field>
        <Field
          label="User memory retention (days)"
          htmlFor="memoryRetentionDays"
        >
          <Input
            id="memoryRetentionDays"
            name="memoryRetentionDays"
            type="number"
            min="1"
            max="3650"
            defaultValue={policy.memoryRetentionDays}
            required
          />
        </Field>
      </div>
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save privacy policy"}
        </Button>
      </div>
    </form>
  );
}
