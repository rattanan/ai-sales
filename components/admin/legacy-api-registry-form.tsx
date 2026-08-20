"use client";

import Link from "next/link";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  FlaskConical,
  KeyRound,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from "lucide-react";
import { useActionState, useMemo, useState } from "react";
import {
  deleteLegacyApiAction,
  generateLegacyApiToolDefinitionAction,
  saveLegacyApiAction,
  testLegacyApiDraftAction,
} from "@/features/legacy-api/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;
type AuthType =
  "NONE" | "API_KEY" | "QUERY_API_KEY" | "BEARER" | "BASIC" | "CUSTOM_HEADER";
type ApiParameter = {
  name: string;
  label: string;
  description: string;
  location: "PATH" | "QUERY" | "BODY";
  type: "STRING" | "NUMBER" | "BOOLEAN";
  required: boolean;
  defaultValue?: string | number | boolean;
};
type LegacyApiValue = {
  id: string;
  name: string;
  description: string;
  baseUrl: string;
  endpointPath: string;
  method: "GET" | "POST";
  readOnlyConfirmed: boolean;
  enabled: boolean;
  allowedDomains: string[];
  timeoutMs: number;
  maxResponseBytes: number;
  maxRedirects: number;
  requestHeadersJson: string;
  parametersJson: string;
  bodyTemplateJson: string;
  responseSchemaJson: string;
  responseMappingJson: string;
  authType: AuthType;
  credentialPresent: boolean;
  sourceScope: "GLOBAL" | "SELECTED_BOTS";
  botIds: string[];
  priority: number;
};

const steps = ["API URL", "Input fields", "Test & output", "Save tool"];
const secretQueryName = /^(appid|api[_-]?key|apikey|key|token|access_token)$/i;

function parsedParameters(value?: string): ApiParameter[] {
  try {
    const parsed = JSON.parse(value ?? "[]") as unknown;
    return Array.isArray(parsed) ? (parsed as ApiParameter[]) : [];
  } catch {
    return [];
  }
}

function friendlyLabel(name: string) {
  const known: Record<string, string> = {
    q: "City or location",
    lat: "Latitude",
    lon: "Longitude",
    units: "Units",
    lang: "Language",
    id: "ID",
  };
  return (
    known[name.toLowerCase()] ??
    name
      .replaceAll(/[_-]+/g, " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

function parameterType(name: string, value: string): ApiParameter["type"] {
  if (/^(lat|lon|limit|offset|page|count|id)$/i.test(name) && value !== "")
    return Number.isFinite(Number(value)) ? "NUMBER" : "STRING";
  if (/^(true|false)$/i.test(value)) return "BOOLEAN";
  return "STRING";
}

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  const data =
    state.ok && state.data && typeof state.data === "object"
      ? (state.data as Record<string, unknown>)
      : null;
  return (
    <div
      role={state.ok ? "status" : "alert"}
      aria-live="polite"
      className={cn(
        "rounded-xl border p-4 text-sm",
        state.ok
          ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
          : "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-100",
      )}
    >
      <div className="flex items-center gap-2 font-medium">
        {state.ok ? <CircleCheck size={18} /> : null}
        {state.ok ? "Operation completed" : state.error.message}
      </div>
      {data && typeof data.summary === "string" ? (
        <p className="mt-2">{data.summary}</p>
      ) : null}
      {data && data.preview !== undefined ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">
          {JSON.stringify(data.preview, null, 2)}
        </pre>
      ) : null}
      {data && data.definition && typeof data.definition === "object" ? (
        <pre className="mt-4 max-h-96 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-100">
          {JSON.stringify(data.definition, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

function JsonArea({
  id,
  name,
  label,
  value,
}: {
  id: string;
  name: string;
  label: string;
  value: string;
}) {
  return (
    <Field label={label} htmlFor={id}>
      <textarea
        id={id}
        name={name}
        rows={5}
        defaultValue={value}
        spellCheck={false}
        className="w-full rounded-lg border bg-background p-3 font-mono text-xs"
      />
    </Field>
  );
}

export function LegacyApiRegistryForm({
  value,
  bots,
}: {
  value?: LegacyApiValue;
  bots: Array<{ id: string; name: string }>;
}) {
  const prefix = value?.id ?? "new";
  const [step, setStep] = useState(0);
  const [endpointUrl, setEndpointUrl] = useState(
    value ? new URL(value.endpointPath, value.baseUrl).href : "",
  );
  const [baseUrl, setBaseUrl] = useState(value?.baseUrl ?? "");
  const [endpointPath, setEndpointPath] = useState(value?.endpointPath ?? "/");
  const [method, setMethod] = useState<"GET" | "POST">(value?.method ?? "GET");
  const [name, setName] = useState(value?.name ?? "");
  const [description, setDescription] = useState(value?.description ?? "");
  const [parameters, setParameters] = useState<ApiParameter[]>(
    parsedParameters(value?.parametersJson),
  );
  const [testValues, setTestValues] = useState<Record<string, string>>({});
  const [authType, setAuthType] = useState<AuthType>(value?.authType ?? "NONE");
  const [queryApiKeyName, setQueryApiKeyName] = useState("appid");
  const [queryApiKey, setQueryApiKey] = useState("");
  const [sourceScope, setSourceScope] = useState<"GLOBAL" | "SELECTED_BOTS">(
    value?.sourceScope ?? (bots.length === 0 ? "GLOBAL" : "SELECTED_BOTS"),
  );
  const [selectedBotIds, setSelectedBotIds] = useState<string[]>(
    value?.botIds ?? [],
  );
  const [discoveryError, setDiscoveryError] = useState("");
  const [tested, setTested] = useState(false);
  const [state, action, pending] = useActionState(saveLegacyApiAction, null);
  const [testState, testAction, testing] = useActionState(
    testLegacyApiDraftAction,
    null,
  );
  const [deleteState, deleteAction, deleting] = useActionState(
    deleteLegacyApiAction,
    null,
  );
  const [definitionState, definitionAction, generatingDefinition] =
    useActionState(generateLegacyApiToolDefinitionAction, null);

  const parameterJson = useMemo(
    () => JSON.stringify(parameters, null, 2),
    [parameters],
  );
  const testParametersJson = useMemo(
    () =>
      JSON.stringify(
        Object.fromEntries(
          Object.entries(testValues).filter(([, item]) => item !== ""),
        ),
      ),
    [testValues],
  );
  const assignmentReady = sourceScope === "GLOBAL" || selectedBotIds.length > 0;

  function inspectEndpoint() {
    try {
      const url = new URL(endpointUrl);
      if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
      const discovered: ApiParameter[] = [];
      const nextTestValues: Record<string, string> = {};
      let discoveredSecret: { name: string; value: string } | null = null;
      for (const match of url.pathname.matchAll(
        /\{([A-Za-z][A-Za-z0-9_]*)\}/g,
      )) {
        const parameterName = match[1];
        discovered.push({
          name: parameterName,
          label: friendlyLabel(parameterName),
          description: `Path value for ${friendlyLabel(parameterName)}`,
          location: "PATH",
          type: "STRING",
          required: true,
        });
      }
      for (const [parameterName, rawValue] of url.searchParams) {
        if (secretQueryName.test(parameterName)) {
          discoveredSecret = {
            name: parameterName,
            value: rawValue.trim(),
          };
          continue;
        }
        const placeholder = /^\{[^}]+\}$/.test(rawValue);
        const required = placeholder;
        const parameter: ApiParameter = {
          name: parameterName,
          label: friendlyLabel(parameterName),
          description: `Query value for ${friendlyLabel(parameterName)}`,
          location: "QUERY",
          type: parameterType(parameterName, placeholder ? "" : rawValue),
          required,
        };
        if (!required && rawValue !== "") parameter.defaultValue = rawValue;
        discovered.push(parameter);
        if (!placeholder && required) nextTestValues[parameterName] = rawValue;
      }
      setBaseUrl(url.origin);
      setEndpointPath(url.pathname || "/");
      setEndpointUrl(`${url.origin}${url.pathname || "/"}`);
      setParameters(discovered);
      setTestValues(nextTestValues);
      if (discoveredSecret) {
        setAuthType("QUERY_API_KEY");
        setQueryApiKeyName(discoveredSecret.name);
        if (!/^\{[^}]+\}$/.test(discoveredSecret.value))
          setQueryApiKey(discoveredSecret.value);
      }
      if (!name) {
        const operation =
          url.pathname.split("/").filter(Boolean).at(-1) ?? url.hostname;
        setName(`${friendlyLabel(operation)} API`);
      }
      if (!description)
        setDescription(`Read data from ${url.hostname}${url.pathname}.`);
      setDiscoveryError("");
      setTested(false);
      setStep(1);
    } catch {
      setDiscoveryError(
        "Enter a complete public API URL, for example https://api.example.com/items?q={query}.",
      );
    }
  }

  function addParameter() {
    const parameterName = `input${parameters.length + 1}`;
    setParameters((current) => [
      ...current,
      {
        name: parameterName,
        label: friendlyLabel(parameterName),
        description: `Query value for ${friendlyLabel(parameterName)}`,
        location: "QUERY",
        type: "STRING",
        required: true,
      },
    ]);
  }

  function updateParameter(index: number, patch: Partial<ApiParameter>) {
    setParameters((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
    setTested(false);
  }

  const savedId =
    !value &&
    state?.ok &&
    state.data &&
    typeof state.data === "object" &&
    "id" in state.data &&
    typeof state.data.id === "string"
      ? state.data.id
      : null;

  return (
    <div className="space-y-6">
      <nav aria-label="API tool setup progress">
        <ol className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {steps.map((label, index) => (
            <li key={label}>
              <button
                type="button"
                onClick={() => index <= step && setStep(index)}
                disabled={index > step}
                aria-current={index === step ? "step" : undefined}
                className={cn(
                  "flex min-h-14 w-full items-center gap-3 rounded-xl border px-3 text-left text-sm transition-colors",
                  index === step && "border-primary bg-blue-50 text-primary",
                  index < step &&
                    "border-emerald-200 bg-emerald-50 text-emerald-800",
                  index > step &&
                    "cursor-not-allowed text-muted-foreground opacity-60",
                )}
              >
                <span
                  className={cn(
                    "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-bold",
                    index === step && "border-primary bg-primary text-white",
                    index < step &&
                      "border-emerald-600 bg-emerald-600 text-white",
                  )}
                >
                  {index < step ? <Check size={15} /> : index + 1}
                </span>
                {label}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <form
        action={action}
        className="space-y-6"
        onSubmit={() => {
          if (step === 1) {
            setTested(true);
            setStep(2);
          }
        }}
      >
        <input type="hidden" name="legacyApiId" value={value?.id ?? ""} />
        <input
          type="hidden"
          name="credentialPresent"
          value={String(value?.credentialPresent ?? false)}
        />
        <input type="hidden" name="baseUrl" value={baseUrl} />
        <input type="hidden" name="endpointPath" value={endpointPath} />
        <input type="hidden" name="method" value={method} />
        <input type="hidden" name="name" value={name} />
        <input type="hidden" name="description" value={description} />
        <input type="hidden" name="authType" value={authType} />
        <input type="hidden" name="parametersJson" value={parameterJson} />
        <input
          type="hidden"
          name="testParametersJson"
          value={testParametersJson}
        />
        <input type="hidden" name="queryApiKeyName" value={queryApiKeyName} />
        <input type="hidden" name="queryApiKey" value={queryApiKey} />
        <input type="hidden" name="requestHeadersJson" value="{}" />
        <input type="hidden" name="bodyTemplateJson" value="null" />
        <input
          type="hidden"
          name="responseSchemaJson"
          value={value?.responseSchemaJson ?? '{"type":"object"}'}
        />
        <input
          type="hidden"
          name="responseMappingJson"
          value={value?.responseMappingJson ?? "{}"}
        />
        <input
          type="hidden"
          name="timeoutMs"
          value={value?.timeoutMs ?? 10000}
        />
        <input
          type="hidden"
          name="maxResponseBytes"
          value={value?.maxResponseBytes ?? 1048576}
        />
        <input
          type="hidden"
          name="maxRedirects"
          value={value?.maxRedirects ?? 0}
        />
        <input type="hidden" name="readOnlyConfirmed" value="on" />

        {step === 0 ? (
          <section className="space-y-5" aria-labelledby="api-url-title">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Step 1
              </p>
              <h2 id="api-url-title" className="mt-1 text-xl font-semibold">
                Paste the API endpoint URL
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Query parameters and path placeholders become input fields
                automatically. The hostname is allowlisted on the server.
              </p>
            </div>
            <div className="grid gap-4 md:grid-cols-[160px_1fr]">
              <Field label="HTTP method" htmlFor={`method-${prefix}`}>
                <select
                  id={`method-${prefix}`}
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as "GET" | "POST")
                  }
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="GET">GET</option>
                  <option value="POST">POST (read-only)</option>
                </select>
              </Field>
              <Field
                label="API endpoint URL"
                htmlFor={`endpoint-url-${prefix}`}
                hint="Example: https://api.openweathermap.org/data/2.5/weather?q={city}&appid={API_KEY}&units=metric"
                error={discoveryError || undefined}
                required
              >
                <Input
                  id={`endpoint-url-${prefix}`}
                  type="url"
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  placeholder="https://api.example.com/items?q={query}"
                  required
                />
              </Field>
            </div>
            <div className="flex justify-end">
              <Button type="button" onClick={inspectEndpoint}>
                Detect input fields <ChevronRight size={17} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="space-y-5" aria-labelledby="input-fields-title">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                  Step 2
                </p>
                <h2
                  id="input-fields-title"
                  className="mt-1 text-xl font-semibold"
                >
                  Enter values for a test call
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Required fields become inputs that Chat can request from
                  users.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={addParameter}>
                <Plus size={17} /> Add field
              </Button>
            </div>
            <div className="space-y-3">
              {parameters.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No input fields were found. Test directly or add a field
                  manually.
                </div>
              ) : null}
              {parameters.map((parameter, index) => (
                <div
                  key={`${parameter.name}-${index}`}
                  className="grid gap-3 rounded-xl border bg-muted/30 p-4 lg:grid-cols-[1fr_150px_150px_auto]"
                >
                  <Field
                    label={parameter.label}
                    htmlFor={`test-${prefix}-${index}`}
                    hint={`${parameter.location} · ${parameter.name}`}
                    required={parameter.required}
                  >
                    <Input
                      id={`test-${prefix}-${index}`}
                      value={testValues[parameter.name] ?? ""}
                      onChange={(event) => {
                        setTestValues((current) => ({
                          ...current,
                          [parameter.name]: event.target.value,
                        }));
                        setTested(false);
                      }}
                      placeholder={
                        parameter.defaultValue === undefined
                          ? `Enter ${parameter.label.toLowerCase()}`
                          : `Default: ${String(parameter.defaultValue)}`
                      }
                      required={parameter.required}
                    />
                  </Field>
                  <Field
                    label="Location"
                    htmlFor={`location-${prefix}-${index}`}
                  >
                    <select
                      id={`location-${prefix}-${index}`}
                      value={parameter.location}
                      onChange={(event) =>
                        updateParameter(index, {
                          location: event.target
                            .value as ApiParameter["location"],
                        })
                      }
                      className="min-h-11 w-full rounded-lg border bg-background px-3"
                    >
                      <option value="QUERY">Query</option>
                      <option value="PATH">Path</option>
                      {method === "POST" ? (
                        <option value="BODY">Body</option>
                      ) : null}
                    </select>
                  </Field>
                  <Field label="Type" htmlFor={`type-${prefix}-${index}`}>
                    <select
                      id={`type-${prefix}-${index}`}
                      value={parameter.type}
                      onChange={(event) =>
                        updateParameter(index, {
                          type: event.target.value as ApiParameter["type"],
                        })
                      }
                      className="min-h-11 w-full rounded-lg border bg-background px-3"
                    >
                      <option value="STRING">Text</option>
                      <option value="NUMBER">Number</option>
                      <option value="BOOLEAN">True / false</option>
                    </select>
                  </Field>
                  <button
                    type="button"
                    aria-label={`Remove ${parameter.label}`}
                    onClick={() =>
                      setParameters((current) =>
                        current.filter((_, itemIndex) => itemIndex !== index),
                      )
                    }
                    className="mt-7 grid size-11 place-items-center rounded-lg text-muted-foreground hover:bg-red-50 hover:text-red-700"
                  >
                    <Trash2 size={17} />
                  </button>
                </div>
              ))}
            </div>
            {authType === "QUERY_API_KEY" ? (
              <div className="grid gap-4 rounded-xl border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900 dark:bg-amber-950/20 md:grid-cols-2">
                <div className="flex gap-3 md:col-span-2">
                  <KeyRound
                    className="mt-0.5 shrink-0 text-amber-700"
                    size={18}
                  />
                  <div>
                    <p className="font-medium">Query API key detected</p>
                    <p className="text-sm text-muted-foreground">
                      The key is encrypted and never exposed as a Chat input
                      field.
                    </p>
                  </div>
                </div>
                <Field
                  label="Query parameter"
                  htmlFor={`query-key-name-${prefix}`}
                >
                  <Input
                    id={`query-key-name-${prefix}`}
                    value={queryApiKeyName}
                    onChange={(event) => setQueryApiKeyName(event.target.value)}
                    required
                  />
                </Field>
                <Field
                  label="API key"
                  htmlFor={`query-key-${prefix}`}
                  hint={
                    value?.credentialPresent
                      ? "Leave blank to keep the saved encrypted key."
                      : undefined
                  }
                >
                  <Input
                    id={`query-key-${prefix}`}
                    type="password"
                    value={queryApiKey}
                    onChange={(event) => {
                      setQueryApiKey(event.target.value);
                      setTested(false);
                    }}
                    autoComplete="new-password"
                    required={!value?.credentialPresent}
                  />
                </Field>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => setStep(0)}>
                <ChevronLeft size={17} /> Back
              </Button>
              <Button type="submit" formAction={testAction} disabled={testing}>
                <FlaskConical size={17} />
                {testing ? "Testing API…" : "Test API"}
              </Button>
            </div>
            {!testState?.ok ? <ActionMessage state={testState} /> : null}
          </section>
        ) : null}

        {step === 2 ? (
          <section className="space-y-5" aria-labelledby="test-output-title">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Step 3
              </p>
              <h2 id="test-output-title" className="mt-1 text-xl font-semibold">
                Review the API output
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Secrets and sensitive fields are masked before this preview is
                shown.
              </p>
            </div>
            <ActionMessage state={testState} />
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>
                <ChevronLeft size={17} /> Change inputs
              </Button>
              <Button
                type="button"
                onClick={() => setStep(3)}
                disabled={testing || !tested || !testState?.ok}
              >
                Continue to save <ChevronRight size={17} />
              </Button>
            </div>
          </section>
        ) : null}

        {step === 3 ? (
          <section className="space-y-5" aria-labelledby="save-tool-title">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Step 4
              </p>
              <h2 id="save-tool-title" className="mt-1 text-xl font-semibold">
                Save and assign the Chat tool
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The description helps Chat decide when this tool is relevant.
              </p>
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Tool name" htmlFor={`name-${prefix}`} required>
                <Input
                  id={`name-${prefix}`}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </Field>
              <Field label="Authentication" htmlFor={`auth-${prefix}`}>
                <select
                  id={`auth-${prefix}`}
                  value={authType}
                  onChange={(event) =>
                    setAuthType(event.target.value as AuthType)
                  }
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="NONE">None</option>
                  <option value="QUERY_API_KEY">API key in query</option>
                  <option value="API_KEY">API key header</option>
                  <option value="BEARER">Bearer token</option>
                  <option value="BASIC">Basic authentication</option>
                  <option value="CUSTOM_HEADER">Custom header</option>
                </select>
              </Field>
              <Field
                label="When should Chat use this tool?"
                htmlFor={`description-${prefix}`}
                className="lg:col-span-2"
                required
              >
                <textarea
                  id={`description-${prefix}`}
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  minLength={10}
                  className="w-full rounded-lg border bg-background p-3 text-sm"
                  required
                />
              </Field>
            </div>
            {authType === "API_KEY" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="API key header"
                  htmlFor={`api-key-header-${prefix}`}
                >
                  <Input
                    id={`api-key-header-${prefix}`}
                    name="apiKeyHeaderName"
                    placeholder="X-API-Key"
                    required={!value?.credentialPresent}
                  />
                </Field>
                <Field label="API key" htmlFor={`api-key-${prefix}`}>
                  <Input
                    id={`api-key-${prefix}`}
                    name="apiKey"
                    type="password"
                    autoComplete="new-password"
                    required={!value?.credentialPresent}
                  />
                </Field>
              </div>
            ) : null}
            {authType === "BEARER" ? (
              <Field label="Bearer token" htmlFor={`bearer-${prefix}`}>
                <Input
                  id={`bearer-${prefix}`}
                  name="bearerToken"
                  type="password"
                  autoComplete="new-password"
                  required={!value?.credentialPresent}
                />
              </Field>
            ) : null}
            {authType === "BASIC" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Username" htmlFor={`basic-user-${prefix}`}>
                  <Input id={`basic-user-${prefix}`} name="basicUsername" />
                </Field>
                <Field label="Password" htmlFor={`basic-password-${prefix}`}>
                  <Input
                    id={`basic-password-${prefix}`}
                    name="basicPassword"
                    type="password"
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            ) : null}
            {authType === "CUSTOM_HEADER" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field label="Header name" htmlFor={`custom-name-${prefix}`}>
                  <Input id={`custom-name-${prefix}`} name="customHeaderName" />
                </Field>
                <Field label="Header value" htmlFor={`custom-value-${prefix}`}>
                  <Input
                    id={`custom-value-${prefix}`}
                    name="customHeaderValue"
                    type="password"
                    autoComplete="new-password"
                  />
                </Field>
              </div>
            ) : null}
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Scope" htmlFor={`scope-${prefix}`}>
                <select
                  id={`scope-${prefix}`}
                  name="sourceScope"
                  value={sourceScope}
                  onChange={(event) =>
                    setSourceScope(
                      event.target.value as "GLOBAL" | "SELECTED_BOTS",
                    )
                  }
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="SELECTED_BOTS">Selected bots</option>
                  <option value="GLOBAL">All eligible bots</option>
                </select>
              </Field>
              <Field label="Priority" htmlFor={`priority-${prefix}`}>
                <Input
                  id={`priority-${prefix}`}
                  name="priority"
                  type="number"
                  min="1"
                  max="1000"
                  defaultValue={value?.priority ?? 100}
                />
              </Field>
            </div>
            <fieldset
              className="rounded-xl border p-4"
              aria-describedby={`bot-assignment-help-${prefix}`}
            >
              <legend className="px-1 text-sm font-medium">Assign bots</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {bots.map((bot) => (
                  <label
                    key={bot.id}
                    className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      name="botIds"
                      value={bot.id}
                      checked={selectedBotIds.includes(bot.id)}
                      disabled={sourceScope === "GLOBAL"}
                      onChange={(event) =>
                        setSelectedBotIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, bot.id])]
                            : current.filter((id) => id !== bot.id),
                        )
                      }
                    />
                    {bot.name}
                  </label>
                ))}
              </div>
              <p
                id={`bot-assignment-help-${prefix}`}
                className={cn(
                  "mt-3 text-sm",
                  !assignmentReady
                    ? "text-amber-700 dark:text-amber-300"
                    : "text-muted-foreground",
                )}
              >
                {sourceScope === "GLOBAL"
                  ? "This tool will be available to all eligible bots."
                  : selectedBotIds.length > 0
                    ? `${selectedBotIds.length} bot${selectedBotIds.length === 1 ? "" : "s"} selected.`
                    : "Select at least one bot, or change Scope to All eligible bots."}
              </p>
            </fieldset>
            <label className="flex min-h-11 items-center gap-3 rounded-xl border px-4 text-sm">
              <input
                name="enabled"
                type="checkbox"
                defaultChecked={value?.enabled ?? true}
              />
              Enable this tool for Chat after saving
            </label>
            <details className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                Advanced output settings
              </summary>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <JsonArea
                  id={`schema-${prefix}`}
                  name="advancedResponseSchema"
                  label="Response JSON Schema (preview)"
                  value={
                    value?.responseSchemaJson ?? '{\n  "type": "object"\n}'
                  }
                />
                <JsonArea
                  id={`mapping-${prefix}`}
                  name="advancedResponseMapping"
                  label="Response mapping (preview)"
                  value={value?.responseMappingJson ?? "{}"}
                />
              </div>
            </details>
            <ActionMessage state={state} />
            {savedId ? (
              <div className="flex flex-wrap gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <Button asChild size="sm">
                  <Link href={`/workspace/sources/api-tools/${savedId}/edit`}>
                    Open saved tool
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href="/workspace/sources/api-tools">
                    View all tools
                  </Link>
                </Button>
              </div>
            ) : null}
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" onClick={() => setStep(2)}>
                <ChevronLeft size={17} /> Back
              </Button>
              <Button
                type="submit"
                disabled={
                  pending || !tested || !testState?.ok || !assignmentReady
                }
              >
                <Save size={17} />
                {pending
                  ? "Saving tool…"
                  : value
                    ? "Save changes"
                    : "Save API tool"}
              </Button>
            </div>
          </section>
        ) : null}
      </form>

      {value ? (
        <div className="grid gap-4 border-t pt-5 lg:grid-cols-[1fr_auto]">
          <form action={definitionAction} className="space-y-3">
            <input type="hidden" name="id" value={value.id} />
            <ActionMessage state={definitionState} />
            <Button
              type="submit"
              variant="outline"
              disabled={generatingDefinition}
            >
              <Sparkles size={17} />
              {generatingDefinition ? "Generating…" : "Generate AI definition"}
            </Button>
          </form>
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!window.confirm(`Delete ${value.name} and its history?`))
                event.preventDefault();
            }}
          >
            <input type="hidden" name="id" value={value.id} />
            <ActionMessage state={deleteState} />
            <Button type="submit" variant="destructive" disabled={deleting}>
              <Trash2 size={17} /> {deleting ? "Deleting…" : "Delete tool"}
            </Button>
          </form>
        </div>
      ) : null}
    </div>
  );
}
