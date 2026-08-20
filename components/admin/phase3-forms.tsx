"use client";

import { useActionState } from "react";
import {
  rotateEmbeddedSecretAction,
  saveAuthenticationPolicyAction,
  saveResourceAclAction,
  simulateResourceAccessAction,
  testExternalAuthenticationAction,
} from "@/features/admin/authentication-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  const data =
    state.ok && state.data && typeof state.data === "object"
      ? state.data
      : null;
  const message =
    data && "message" in data ? String(data.message) : "Saved successfully.";
  const secret =
    data && "signingSecret" in data ? String(data.signingSecret ?? "") : "";
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
      <p>{state.ok ? message : state.error.message}</p>
      {secret ? (
        <div className="mt-3">
          <p className="font-semibold">One-time signing secret</p>
          <code className="mt-1 block overflow-x-auto rounded bg-slate-950 p-3 text-xs text-white">
            {secret}
          </code>
        </div>
      ) : null}
    </div>
  );
}

type AuthenticationValue = {
  localEnabled: boolean;
  externalApiEnabled: boolean;
  embeddedEnabled: boolean;
  modePriority: string[];
  embedded?: {
    keyId: string;
    signatureMode: string;
    allowedOrigins: string[];
    replayWindowSeconds: number;
    sessionTtlSeconds: number;
    lastRotatedAt: string;
  };
  external?: {
    url: string;
    method: string;
    timeoutMs: number;
    headers: Record<string, string>;
    requestMapping: Record<string, string>;
    responseMapping: Record<string, string>;
    secretHeaderName?: string;
    hasSecret: boolean;
    lastHealthStatus?: string;
    lastHealthMessage?: string;
  };
};

const modes = ["EMBEDDED", "EXTERNAL_API", "LOCAL"];

export function AuthenticationPolicyForm({
  value,
}: {
  value: AuthenticationValue;
}) {
  const [state, action, pending] = useActionState(
    saveAuthenticationPolicyAction,
    null,
  );
  const [rotation, rotate, rotating] = useActionState(
    rotateEmbeddedSecretAction,
    null,
  );
  const request = value.external?.requestMapping ?? {};
  const response = value.external?.responseMapping ?? {};
  return (
    <div className="space-y-6">
      <form action={action} className="space-y-6">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Authentication policy</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Enable at least one mode. Credential login follows the configured
              priority without falling back after a provider rejection.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              ["localEnabled", "Local credentials", value.localEnabled],
              [
                "externalApiEnabled",
                "External Auth API",
                value.externalApiEnabled,
              ],
              [
                "embeddedEnabled",
                "Embedded signed identity",
                value.embeddedEnabled,
              ],
            ].map(([name, label, checked]) => (
              <label
                key={String(name)}
                className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm"
              >
                <input
                  name={String(name)}
                  type="checkbox"
                  defaultChecked={Boolean(checked)}
                />
                {String(label)}
              </label>
            ))}
          </div>
          <fieldset className="grid gap-3 sm:grid-cols-3">
            <legend className="mb-2 text-sm font-medium">Mode priority</legend>
            {[0, 1, 2].map((index) => (
              <label key={index} className="text-sm">
                <span className="mb-1 block text-muted-foreground">
                  Priority {index + 1}
                </span>
                <select
                  name="modePriority"
                  defaultValue={value.modePriority[index] ?? modes[index]}
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  {modes.map((mode) => (
                    <option key={mode}>{mode}</option>
                  ))}
                </select>
              </label>
            ))}
          </fieldset>
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Embedded identity and widget</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Only signed role and department claims are trusted. Origins must
              match exactly.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Signature mode" htmlFor="signatureMode">
              <select
                id="signatureMode"
                name="signatureMode"
                defaultValue={value.embedded?.signatureMode ?? "BOTH"}
                className="min-h-11 w-full rounded-lg border bg-background px-3"
              >
                <option value="BOTH">HMAC SHA-256 + JWT HS256</option>
                <option value="HMAC_SHA256">HMAC SHA-256</option>
                <option value="JWT_HS256">JWT HS256</option>
              </select>
            </Field>
            <Field label="Key ID" htmlFor="keyId">
              <Input
                id="keyId"
                value={value.embedded?.keyId ?? "Created when saved"}
                readOnly
              />
            </Field>
            <Field
              label="Replay window (seconds)"
              htmlFor="replayWindowSeconds"
            >
              <Input
                id="replayWindowSeconds"
                name="replayWindowSeconds"
                type="number"
                min="30"
                max="900"
                defaultValue={value.embedded?.replayWindowSeconds ?? 300}
                required
              />
            </Field>
            <Field label="Session TTL (seconds)" htmlFor="sessionTtlSeconds">
              <Input
                id="sessionTtlSeconds"
                name="sessionTtlSeconds"
                type="number"
                min="300"
                max="86400"
                defaultValue={value.embedded?.sessionTtlSeconds ?? 28800}
                required
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Allowed host origins — one per line"
                htmlFor="allowedOrigins"
                required
              >
                <textarea
                  id="allowedOrigins"
                  name="allowedOrigins"
                  rows={4}
                  defaultValue={value.embedded?.allowedOrigins.join("\n")}
                  placeholder="https://portal.example.com"
                  className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">External Authentication API</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Use POST where possible. Passwords and secret header values are
              never written to audit logs.
            </p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Endpoint URL" htmlFor="externalUrl">
              <Input
                id="externalUrl"
                name="externalUrl"
                type="url"
                defaultValue={value.external?.url}
                placeholder="https://identity.example.com/authenticate"
              />
            </Field>
            <Field label="HTTP method" htmlFor="externalMethod">
              <select
                id="externalMethod"
                name="externalMethod"
                defaultValue={value.external?.method ?? "POST"}
                className="min-h-11 w-full rounded-lg border bg-background px-3"
              >
                <option>POST</option>
                <option>PUT</option>
                <option>GET</option>
              </select>
            </Field>
            <Field label="Timeout (ms)" htmlFor="externalTimeoutMs">
              <Input
                id="externalTimeoutMs"
                name="externalTimeoutMs"
                type="number"
                min="500"
                max="30000"
                defaultValue={value.external?.timeoutMs ?? 10000}
                required
              />
            </Field>
            <Field
              label={
                value.external?.hasSecret
                  ? "Secret header name (configured)"
                  : "Secret header name"
              }
              htmlFor="secretHeaderName"
            >
              <Input
                id="secretHeaderName"
                name="secretHeaderName"
                defaultValue={value.external?.secretHeaderName}
                placeholder="x-api-key"
              />
            </Field>
            <Field
              label={
                value.external?.hasSecret
                  ? "Secret header value (leave blank to keep)"
                  : "Secret header value"
              }
              htmlFor="secretHeaderValue"
            >
              <Input
                id="secretHeaderValue"
                name="secretHeaderValue"
                type="password"
                autoComplete="new-password"
              />
            </Field>
            <Field
              label="Non-secret headers — Header: value per line"
              htmlFor="externalHeaders"
            >
              <textarea
                id="externalHeaders"
                name="externalHeaders"
                rows={3}
                defaultValue={Object.entries(value.external?.headers ?? {})
                  .map(([key, item]) => `${key}: ${item}`)
                  .join("\n")}
                className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
              />
            </Field>
          </div>
          <fieldset className="grid gap-4 border-t pt-4 md:grid-cols-2">
            <legend className="px-1 text-sm font-semibold">
              Request and response mapping
            </legend>
            {[
              [
                "requestUsernameField",
                "Request username field",
                request.usernameField ?? "username",
              ],
              [
                "requestPasswordField",
                "Request password field",
                request.passwordField ?? "password",
              ],
              [
                "responseSuccessPath",
                "Success path (must equal true)",
                response.successPath ?? "success",
              ],
              [
                "responseExternalUserIdPath",
                "External user ID path",
                response.externalUserIdPath ?? "user.id",
              ],
              [
                "responseUsernamePath",
                "Username path",
                response.usernamePath ?? "user.username",
              ],
              [
                "responseNamePath",
                "Name path",
                response.namePath ?? "user.name",
              ],
              [
                "responseRolePath",
                "Role path",
                response.rolePath ?? "user.role",
              ],
              [
                "responseDepartmentPath",
                "Department path",
                response.departmentPath ?? "user.department",
              ],
            ].map(([name, label, defaultValue]) => (
              <Field
                key={name}
                label={label}
                htmlFor={name}
                required={[
                  "requestUsernameField",
                  "requestPasswordField",
                  "responseSuccessPath",
                  "responseExternalUserIdPath",
                  "responseRolePath",
                ].includes(name)}
              >
                <Input id={name} name={name} defaultValue={defaultValue} />
              </Field>
            ))}
          </fieldset>
        </section>
        <ActionMessage state={state} />
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save authentication policy"}
        </Button>
      </form>
      {value.embedded ? (
        <form
          action={rotate}
          className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          <h2 className="font-semibold text-amber-950">
            Signing secret rotation
          </h2>
          <p className="text-sm text-amber-900">
            Rotating revokes all active embedded sessions. The new secret
            appears once.
          </p>
          <ActionMessage state={rotation} />
          <Button variant="outline" disabled={rotating}>
            {rotating ? "Rotating…" : "Rotate signing secret"}
          </Button>
        </form>
      ) : null}
    </div>
  );
}

export function ExternalAuthenticationTestForm() {
  const [state, action, pending] = useActionState(
    testExternalAuthenticationAction,
    null,
  );
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Test username" htmlFor="testUsername">
        <Input id="testUsername" name="username" autoComplete="off" required />
      </Field>
      <Field label="Test password" htmlFor="testPassword">
        <Input
          id="testPassword"
          name="password"
          type="password"
          autoComplete="new-password"
          required
        />
      </Field>
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button variant="outline" disabled={pending}>
          {pending ? "Testing…" : "Test saved contract"}
        </Button>
      </div>
    </form>
  );
}

type Principal = { id: string; label: string };
const resourceTypes = [
  "BOT",
  "KNOWLEDGE_RACK",
  "KNOWLEDGE_SOURCE",
  "DOCUMENT",
  "DATA_SOURCE",
  "DATABASE_SCHEMA",
  "DATABASE_TABLE",
  "LEGACY_API",
  "CHAT",
  "INSIGHT",
];

export function ResourceAclForm({
  users,
  roles,
}: {
  users: Principal[];
  roles: Principal[];
}) {
  const [state, action, pending] = useActionState(saveResourceAclAction, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Resource type" htmlFor="aclResourceType">
        <select
          id="aclResourceType"
          name="resourceType"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          {resourceTypes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="Resource ID" htmlFor="aclResourceId" required>
        <Input
          id="aclResourceId"
          name="resourceId"
          required
          placeholder="Database schema/table: dataSourceId:schema[:table]"
        />
      </Field>
      <Field label="User (choose user or role)" htmlFor="aclUser">
        <select
          id="aclUser"
          name="userId"
          defaultValue=""
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="">No user</option>
          {users.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Role (choose user or role)" htmlFor="aclRole">
        <select
          id="aclRole"
          name="roleId"
          defaultValue=""
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="">No role</option>
          {roles.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Effect" htmlFor="aclEffect">
        <select
          id="aclEffect"
          name="effect"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option>ALLOW</option>
          <option>DENY</option>
        </select>
      </Field>
      <Field label="Access level" htmlFor="aclAccess">
        <select
          id="aclAccess"
          name="accessLevel"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option>VIEW</option>
          <option>USE</option>
          <option>EDIT</option>
          <option>MANAGE</option>
        </select>
      </Field>
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending}>
          {pending ? "Saving…" : "Save resource rule"}
        </Button>
      </div>
    </form>
  );
}

export function AccessSimulatorForm({ users }: { users: Principal[] }) {
  const [state, action, pending] = useActionState(
    simulateResourceAccessAction,
    null,
  );
  const decision =
    state?.ok && state.data && typeof state.data === "object"
      ? (state.data as {
          allowed?: boolean;
          reason?: string;
          precedence?: string[];
          inheritedFrom?: { resourceType: string; resourceId: string };
        })
      : null;
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Subject user" htmlFor="simUser">
        <select
          id="simUser"
          name="userId"
          required
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option value="">Choose user</option>
          {users.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Resource type" htmlFor="simType">
        <select
          id="simType"
          name="resourceType"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          {resourceTypes.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field label="Resource ID" htmlFor="simResource" required>
        <Input id="simResource" name="resourceId" required />
      </Field>
      <Field label="Required access" htmlFor="simLevel">
        <select
          id="simLevel"
          name="accessLevel"
          className="min-h-11 w-full rounded-lg border bg-background px-3"
        >
          <option>VIEW</option>
          <option>USE</option>
          <option>EDIT</option>
          <option>MANAGE</option>
        </select>
      </Field>
      <div className="space-y-3 md:col-span-2">
        {!state?.ok ? <ActionMessage state={state} /> : null}
        {decision ? (
          <div
            role="status"
            className={
              decision.allowed
                ? "rounded-lg bg-emerald-50 p-4 text-emerald-900"
                : "rounded-lg bg-red-50 p-4 text-red-900"
            }
          >
            <p className="font-semibold">
              {decision.allowed ? "ALLOWED" : "DENIED"} · {decision.reason}
            </p>
            <ol className="mt-2 list-decimal pl-5 text-sm">
              {decision.precedence?.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            {decision.inheritedFrom ? (
              <p className="mt-2 text-sm">
                Inherited from {decision.inheritedFrom.resourceType}:{" "}
                {decision.inheritedFrom.resourceId}
              </p>
            ) : null}
          </div>
        ) : null}
        <Button disabled={pending}>
          {pending ? "Simulating…" : "Simulate access"}
        </Button>
      </div>
    </form>
  );
}
