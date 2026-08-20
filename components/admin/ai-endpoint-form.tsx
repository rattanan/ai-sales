"use client";

import { useActionState } from "react";
import {
  saveAiEndpointAction,
  testAiEndpointAction,
} from "@/features/admin/ai-endpoint-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ActionState =
  | { ok: true; data: unknown }
  | {
      ok: false;
      error: {
        message: string;
        fieldErrors?: Record<string, string[]>;
      };
    }
  | null;

export type AiEndpointFormValue = {
  id: string;
  name: string;
  kind: "CHAT" | "EMBEDDING";
  providerType: "OPENAI_COMPATIBLE" | "OLLAMA";
  baseUrl: string;
  model: string;
  temperature: number | null;
  maxTokens: number | null;
  batchSize: number | null;
  vectorDimension: number | null;
  timeoutMs: number;
  maxRetries: number;
  active: boolean;
  credentialPresent: boolean;
};

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  const details =
    state.ok && state.data && typeof state.data === "object"
      ? (state.data as Record<string, unknown>)
      : null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={
        state.ok
          ? "rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800"
          : "rounded-lg bg-red-50 p-3 text-sm text-red-800"
      }
    >
      <p>{state.ok ? "Operation completed." : state.error.message}</p>
      {details?.dimension ? (
        <p className="mt-1">
          Detected vector dimension: {String(details.dimension)}
        </p>
      ) : null}
      {details?.latencyMs ? (
        <p className="mt-1">Response time: {String(details.latencyMs)} ms</p>
      ) : null}
      {details?.sourcesMarkedNeedsReindex ? (
        <p className="mt-1 font-medium">
          Existing document sources were marked for re-indexing. Queued:{" "}
          {String(details.reindexQueued ?? 0)}; queue failures:{" "}
          {String(details.reindexFailed ?? 0)}.
        </p>
      ) : null}
    </div>
  );
}

function fieldError(state: ActionState, name: string) {
  return state && !state.ok ? state.error.fieldErrors?.[name]?.[0] : undefined;
}

export function AiEndpointForm({
  kind,
  value,
}: {
  kind: "CHAT" | "EMBEDDING";
  value?: AiEndpointFormValue;
}) {
  const [state, action, pending] = useActionState(saveAiEndpointAction, null);
  const [testState, testAction, testing] = useActionState(
    testAiEndpointAction,
    null,
  );
  const prefix = value?.id ?? `${kind.toLowerCase()}-new`;
  const embedding = kind === "EMBEDDING";
  return (
    <div className="space-y-5">
      <form action={action} className="grid gap-5 md:grid-cols-2">
        <input type="hidden" name="kind" value={kind} />
        <input
          type="hidden"
          name="credentialPresent"
          value={String(value?.credentialPresent ?? false)}
        />
        {value ? (
          <input type="hidden" name="endpointId" value={value.id} />
        ) : null}
        <Field
          label="Configuration name"
          htmlFor={`endpoint-name-${prefix}`}
          error={fieldError(state, "name")}
          required
        >
          <Input
            id={`endpoint-name-${prefix}`}
            name="name"
            defaultValue={value?.name}
            placeholder={
              embedding ? "Production embeddings" : "Primary chat AI"
            }
            aria-invalid={Boolean(fieldError(state, "name"))}
            required
          />
        </Field>
        <Field
          label="Provider type"
          htmlFor={`endpoint-provider-${prefix}`}
          error={fieldError(state, "providerType")}
          required
        >
          <select
            id={`endpoint-provider-${prefix}`}
            name="providerType"
            defaultValue={value?.providerType ?? "OPENAI_COMPATIBLE"}
            aria-invalid={Boolean(fieldError(state, "providerType"))}
            className="min-h-11 w-full rounded-lg border bg-background px-3 text-sm"
          >
            <option value="OPENAI_COMPATIBLE">OpenAI-compatible</option>
            {embedding ? (
              <option value="OLLAMA">Ollama native /api/embed</option>
            ) : null}
          </select>
        </Field>
        <Field
          label={
            embedding
              ? "Base URL or embedding endpoint"
              : "Base URL or chat endpoint"
          }
          htmlFor={`endpoint-url-${prefix}`}
          hint={
            embedding
              ? "Accepts an exact /api/embed or /embeddings URL, or a provider base URL."
              : "Accepts an exact /chat/completions URL or an OpenAI-compatible base URL."
          }
          error={fieldError(state, "baseUrl")}
          required
        >
          <Input
            id={`endpoint-url-${prefix}`}
            name="baseUrl"
            type="url"
            defaultValue={value?.baseUrl}
            placeholder={
              embedding
                ? "https://embedding.example/api/embed"
                : "https://ai.example/v1"
            }
            aria-invalid={Boolean(fieldError(state, "baseUrl"))}
            required
          />
        </Field>
        <Field
          label="Model"
          htmlFor={`endpoint-model-${prefix}`}
          hint={
            embedding
              ? "Use the model ID only. Gemini OpenAI compatibility must not include :embedContent."
              : undefined
          }
          error={fieldError(state, "model")}
          required
        >
          <Input
            id={`endpoint-model-${prefix}`}
            name="model"
            defaultValue={value?.model}
            placeholder={embedding ? "embedding-model" : "chat-model"}
            aria-invalid={Boolean(fieldError(state, "model"))}
            required
          />
        </Field>
        <Field
          label={
            value?.credentialPresent
              ? "API key (leave blank to keep ••••••••)"
              : "API key (optional)"
          }
          htmlFor={`endpoint-key-${prefix}`}
          error={fieldError(state, "apiKey")}
        >
          <Input
            id={`endpoint-key-${prefix}`}
            name="apiKey"
            type="password"
            autoComplete="new-password"
            aria-invalid={Boolean(fieldError(state, "apiKey"))}
          />
        </Field>
        {embedding ? (
          <>
            <Field
              label="Batch size"
              htmlFor={`endpoint-batch-${prefix}`}
              error={fieldError(state, "batchSize")}
            >
              <Input
                id={`endpoint-batch-${prefix}`}
                name="batchSize"
                type="number"
                min="1"
                max="200"
                defaultValue={value?.batchSize ?? 16}
                aria-invalid={Boolean(fieldError(state, "batchSize"))}
                required
              />
            </Field>
            <Field
              label="Expected vector dimension"
              htmlFor={`endpoint-dimension-${prefix}`}
              hint="Optional. Test Embedding detects the actual dimension."
              error={fieldError(state, "vectorDimension")}
            >
              <Input
                id={`endpoint-dimension-${prefix}`}
                name="vectorDimension"
                type="number"
                min="1"
                defaultValue={value?.vectorDimension ?? undefined}
                aria-invalid={Boolean(fieldError(state, "vectorDimension"))}
              />
            </Field>
            <input type="hidden" name="temperature" value="0" />
            <input type="hidden" name="maxTokens" value="128" />
          </>
        ) : (
          <>
            <Field
              label="Temperature"
              htmlFor={`endpoint-temperature-${prefix}`}
              error={fieldError(state, "temperature")}
            >
              <Input
                id={`endpoint-temperature-${prefix}`}
                name="temperature"
                type="number"
                min="0"
                max="2"
                step="0.1"
                defaultValue={value?.temperature ?? 0.1}
                aria-invalid={Boolean(fieldError(state, "temperature"))}
                required
              />
            </Field>
            <Field
              label="Maximum tokens"
              htmlFor={`endpoint-tokens-${prefix}`}
              error={fieldError(state, "maxTokens")}
            >
              <Input
                id={`endpoint-tokens-${prefix}`}
                name="maxTokens"
                type="number"
                min="128"
                defaultValue={value?.maxTokens ?? 4096}
                aria-invalid={Boolean(fieldError(state, "maxTokens"))}
                required
              />
            </Field>
            <input type="hidden" name="batchSize" value="1" />
          </>
        )}
        <Field
          label="Timeout (ms)"
          htmlFor={`endpoint-timeout-${prefix}`}
          error={fieldError(state, "timeoutMs")}
        >
          <Input
            id={`endpoint-timeout-${prefix}`}
            name="timeoutMs"
            type="number"
            min="1000"
            max="300000"
            defaultValue={value?.timeoutMs ?? (embedding ? 120000 : 180000)}
            aria-invalid={Boolean(fieldError(state, "timeoutMs"))}
            required
          />
        </Field>
        <Field
          label="Retries"
          htmlFor={`endpoint-retries-${prefix}`}
          error={fieldError(state, "maxRetries")}
        >
          <Input
            id={`endpoint-retries-${prefix}`}
            name="maxRetries"
            type="number"
            min="0"
            max="5"
            defaultValue={value?.maxRetries ?? 2}
            aria-invalid={Boolean(fieldError(state, "maxRetries"))}
            required
          />
        </Field>
        <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
          <input name="active" type="checkbox" defaultChecked={value?.active} />
          Use as the active {embedding ? "embedding" : "chat"} endpoint
        </label>
        <div className="space-y-3 md:col-span-2">
          <ActionMessage state={state} />
          <Button disabled={pending}>
            {pending ? "Saving…" : value ? "Save endpoint" : "Add endpoint"}
          </Button>
        </div>
      </form>
      {value ? (
        <form action={testAction} className="space-y-3 border-t pt-5">
          <input type="hidden" name="endpointId" value={value.id} />
          <ActionMessage state={testState} />
          <Button type="submit" variant="outline" disabled={testing}>
            {testing
              ? "Testing…"
              : embedding
                ? "Test Embedding"
                : "Test Chat Connection"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}
