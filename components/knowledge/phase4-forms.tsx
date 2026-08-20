"use client";

import { useActionState, useState } from "react";
import {
  createSharedFolderSourceAction,
  createWebSourceAction,
} from "@/features/knowledge/source-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type RackChoice = { id: string; name: string };
type ActionState =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string } }
  | null;

function ActionMessage({ state }: { state: ActionState }) {
  if (!state) return null;
  const warning =
    state.ok &&
    typeof state.data === "object" &&
    state.data !== null &&
    "scheduleWarning" in state.data &&
    typeof state.data.scheduleWarning === "string"
      ? state.data.scheduleWarning
      : null;
  const refreshWarning =
    state?.ok &&
    typeof state.data === "object" &&
    state.data !== null &&
    "refreshWarning" in state.data &&
    typeof state.data.refreshWarning === "string"
      ? state.data.refreshWarning
      : null;
  return (
    <p
      aria-live="polite"
      className={
        state.ok ? "text-sm text-emerald-700" : "text-sm text-destructive"
      }
    >
      {state.ok
        ? [warning, refreshWarning].filter(Boolean).join(" ") ||
          "Source created and its first refresh was queued."
        : state.error.message}
    </p>
  );
}

function ScheduleFields({
  prefix,
  defaultMinutes,
}: {
  prefix: string;
  defaultMinutes: number;
}) {
  return (
    <>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="scheduleEnabled" type="checkbox" />
        Refresh automatically
      </label>
      <Field label="Refresh interval (minutes)" htmlFor={`${prefix}-interval`}>
        <Input
          id={`${prefix}-interval`}
          name="intervalMinutes"
          type="number"
          min="5"
          max="10080"
          defaultValue={defaultMinutes}
          required
        />
      </Field>
    </>
  );
}

function RackSelect({ id, racks }: { id: string; racks: RackChoice[] }) {
  return (
    <Field label="Knowledge rack" htmlFor={id} required>
      <select
        id={id}
        name="rackId"
        className="min-h-11 w-full rounded-lg border bg-background px-3"
        required
      >
        <option value="">Select a rack</option>
        {racks.map((rack) => (
          <option key={rack.id} value={rack.id}>
            {rack.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function SharedFolderSourceForm({
  racks,
  allowedRoots,
  googleDriveServiceAccountEmail,
}: {
  racks: RackChoice[];
  allowedRoots: string[];
  googleDriveServiceAccountEmail?: string | null;
}) {
  const [state, action, pending] = useActionState(
    createSharedFolderSourceAction,
    null,
  );
  const [location, setLocation] = useState<"GOOGLE_DRIVE" | "MOUNTED_FOLDER">(
    "GOOGLE_DRIVE",
  );
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <RackSelect id="folder-rack" racks={racks} />
      <Field label="Source name" htmlFor="folder-name" required>
        <Input
          id="folder-name"
          name="name"
          placeholder="Team policies folder"
          required
        />
      </Field>
      <div className="md:col-span-2">
        <fieldset>
          <legend className="text-sm font-medium">Folder location</legend>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            {[
              ["GOOGLE_DRIVE", "Google Drive", "Paste a shared folder URL"],
              [
                "MOUNTED_FOLDER",
                "Mounted folder",
                "Use an approved server path",
              ],
            ].map(([value, title, description]) => (
              <label
                key={value}
                className={cn(
                  "flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3",
                  location === value && "border-primary bg-secondary",
                )}
              >
                <input
                  type="radio"
                  name="sharedFolderLocation"
                  value={value}
                  checked={location === value}
                  onChange={() =>
                    setLocation(value as "GOOGLE_DRIVE" | "MOUNTED_FOLDER")
                  }
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium">{title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>
      <div className="md:col-span-2">
        {location === "GOOGLE_DRIVE" ? (
          <>
            <Field
              label="Google Drive folder URL"
              htmlFor="folder-url"
              hint="Share the folder with the service account as Viewer before creating the source."
              required
            >
              <Input
                id="folder-url"
                name="rootPath"
                type="url"
                pattern="https://drive\.google\.com/drive/(u/[0-9]+/)?folders/[A-Za-z0-9_-]+.*"
                placeholder="https://drive.google.com/drive/folders/…"
                required
              />
            </Field>
            <p
              className="mt-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
              role="note"
            >
              {googleDriveServiceAccountEmail
                ? `Share this folder as Viewer with ${googleDriveServiceAccountEmail}.`
                : "Google Drive is not configured on this server yet."}
            </p>
          </>
        ) : (
          <>
            <Field
              label="Pre-mounted folder path"
              htmlFor="folder-path"
              required
            >
              <Input
                id="folder-path"
                name="rootPath"
                placeholder={`${allowedRoots[0] ?? "/mnt/insightkm-knowledge"}/policies`}
                required
              />
            </Field>
            <p className="mt-1 text-xs text-muted-foreground">
              Allowed root{allowedRoots.length === 1 ? "" : "s"}:{" "}
              {allowedRoots.join(", ")}. Symbolic links are rejected.
            </p>
          </>
        )}
      </div>
      <Field label="Maximum files per scan" htmlFor="folder-max-files">
        <Input
          id="folder-max-files"
          name="maxFiles"
          type="number"
          min="1"
          max="100000"
          defaultValue="10000"
          required
        />
      </Field>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input name="includeSubdirectories" type="checkbox" defaultChecked />
        Include subdirectories
      </label>
      <ScheduleFields prefix="folder" defaultMinutes={60} />
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending || !racks.length}>
          {pending ? "Creating…" : "Create shared-folder source"}
        </Button>
      </div>
    </form>
  );
}

export function WebSourceForm({ racks }: { racks: RackChoice[] }) {
  const [state, action, pending] = useActionState(createWebSourceAction, null);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <RackSelect id="web-rack" racks={racks} />
      <Field label="Source name" htmlFor="web-name" required>
        <Input
          id="web-name"
          name="name"
          placeholder="Employee handbook"
          required
        />
      </Field>
      <div className="md:col-span-2">
        <Field label="Page URL" htmlFor="web-url" required>
          <Input
            id="web-url"
            name="url"
            type="url"
            placeholder="https://docs.example.com/handbook"
            required
          />
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field
          label="Allowed domains (one per line)"
          htmlFor="web-domains"
          required
        >
          <textarea
            id="web-domains"
            name="allowedDomains"
            className="min-h-24 w-full rounded-lg border bg-background p-3 text-sm"
            placeholder="docs.example.com"
            required
          />
        </Field>
        <p className="mt-1 text-xs text-muted-foreground">
          Links are followed up to two levels on the exact starting hostname.
          Every DNS answer, redirect, and canonical URL must remain public.
        </p>
      </div>
      <Field label="Timeout (milliseconds)" htmlFor="web-timeout">
        <Input
          id="web-timeout"
          name="timeoutMs"
          type="number"
          min="1000"
          max="60000"
          defaultValue="15000"
          required
        />
      </Field>
      <Field label="Maximum response bytes" htmlFor="web-bytes">
        <Input
          id="web-bytes"
          name="maxBytes"
          type="number"
          min="1024"
          max="26214400"
          defaultValue="5242880"
          required
        />
      </Field>
      <Field label="Maximum redirects" htmlFor="web-redirects">
        <Input
          id="web-redirects"
          name="maxRedirects"
          type="number"
          min="0"
          max="5"
          defaultValue="3"
          required
        />
      </Field>
      <ScheduleFields prefix="web" defaultMinutes={360} />
      <div className="space-y-3 md:col-span-2">
        <ActionMessage state={state} />
        <Button disabled={pending || !racks.length}>
          {pending ? "Creating…" : "Create web source"}
        </Button>
      </div>
    </form>
  );
}
