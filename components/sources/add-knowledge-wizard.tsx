"use client";

import {
  useActionState,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  FolderSync,
  Globe2,
  Plus,
  Type,
  UploadCloud,
  X,
} from "lucide-react";
import { addKnowledgeAction } from "@/features/knowledge/add-knowledge-action";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Select, Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Choice = { id: string; name: string };
type KnowledgeKind = "FILE" | "COPIED_TEXT" | "WEB" | "SHARED_FOLDER";
type ActionState =
  | { ok: true; data: { id: string; uploadRequired?: boolean } }
  | { ok: false; error: { message: string } }
  | null;

const kinds: Array<{
  value: KnowledgeKind;
  title: string;
  description: string;
  icon: typeof FileText;
}> = [
  {
    value: "FILE",
    title: "File Upload",
    description: "PDF, DOCX, XLSX, CSV, text, Markdown, or HTML",
    icon: UploadCloud,
  },
  {
    value: "COPIED_TEXT",
    title: "Copied Text",
    description: "Paste notes, policies, FAQs, or other text",
    icon: Type,
  },
  {
    value: "WEB",
    title: "URL",
    description: "Connect and refresh a public web page",
    icon: Globe2,
  },
  {
    value: "SHARED_FOLDER",
    title: "Shared Folder",
    description: "Sync Google Drive or an approved mounted folder",
    icon: FolderSync,
  },
];

const steps = ["Choose type", "Add details", "Set access"];

export function AddKnowledgeWizard({
  folders,
  bots,
  googleDriveServiceAccountEmail,
}: {
  folders: Choice[];
  bots: Choice[];
  googleDriveServiceAccountEmail?: string | null;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const selectedFileRef = useRef<File | null>(null);
  const handledSource = useRef<string | null>(null);
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [kind, setKind] = useState<KnowledgeKind>("FILE");
  const [scope, setScope] = useState<"GLOBAL" | "SELECTED_BOTS">(
    "SELECTED_BOTS",
  );
  const [fileName, setFileName] = useState("");
  const [sharedFolderLocation, setSharedFolderLocation] = useState<
    "GOOGLE_DRIVE" | "MOUNTED_FOLDER"
  >("GOOGLE_DRIVE");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [state, action, pending] = useActionState(addKnowledgeAction, null) as [
    ActionState,
    (payload: FormData) => void,
    boolean,
  ];

  const uploadSelectedFile = useCallback(
    async (sourceId: string) => {
      const file = selectedFileRef.current;
      if (!file) {
        setUploadError(
          "The source was created, but the selected file is missing. Close this dialog and select the file again.",
        );
        return;
      }
      setUploadError(null);
      setUploading(true);
      const body = new FormData();
      body.set("file", file);
      try {
        const response = await fetch(
          `/api/knowledge-sources/${sourceId}/documents`,
          {
            method: "POST",
            body,
          },
        );
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            message?: string;
          } | null;
          throw new Error(
            payload?.message ?? `File upload failed (HTTP ${response.status}).`,
          );
        }
        setComplete(true);
        router.refresh();
      } catch (error: unknown) {
        setUploadError(
          error instanceof Error ? error.message : "File upload failed.",
        );
      } finally {
        setUploading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!state?.ok || handledSource.current === state.data.id) return;
    handledSource.current = state.data.id;
    queueMicrotask(() => {
      if (!state.data.uploadRequired) {
        setComplete(true);
        router.refresh();
        return;
      }
      // A successful React form action resets uncontrolled fields before this
      // effect runs. Keep the selected File separately so the follow-up upload
      // is not lost when the file input is cleared.
      void uploadSelectedFile(state.data.id);
    });
  }, [router, state, uploadSelectedFile]);

  function resetWizard() {
    setStep(1);
    setKind("FILE");
    setScope("SELECTED_BOTS");
    setFileName("");
    setSharedFolderLocation("GOOGLE_DRIVE");
    setUploadError(null);
    setComplete(false);
    selectedFileRef.current = null;
    handledSource.current = null;
    formRef.current?.reset();
  }

  function closeDialog() {
    dialogRef.current?.close();
    resetWizard();
  }

  function nextStep() {
    if (step === 2) {
      const details = formRef.current?.querySelector<HTMLElement>(
        "[data-knowledge-details]",
      );
      const fields = details?.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >("input, textarea, select");
      for (const field of fields ?? []) {
        if (!field.checkValidity()) {
          field.reportValidity();
          return;
        }
      }
    }
    setStep((current) => Math.min(3, current + 1));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    const formData = new FormData(event.currentTarget);
    if (!formData.get("rackId")) {
      event.preventDefault();
      setUploadError("Select a Knowledge Folder.");
      return;
    }
    if (scope === "SELECTED_BOTS") {
      const selected = formData.getAll("botIds");
      if (!selected.length) {
        event.preventDefault();
        setUploadError("Select at least one bot or choose All bots.");
      }
    }
  }

  const activeKind = kinds.find((item) => item.value === kind)!;
  const ActiveKindIcon = activeKind.icon;

  return (
    <>
      <Button onClick={() => dialogRef.current?.showModal()}>
        <Plus size={18} aria-hidden="true" /> Add Knowledge
      </Button>
      <dialog
        ref={dialogRef}
        onCancel={(event) => {
          if (pending || uploading) event.preventDefault();
        }}
        onClose={() => {
          if (!complete) setUploadError(null);
        }}
        className="m-auto max-h-[92vh] w-[min(760px,calc(100%-2rem))] overflow-hidden rounded-2xl border bg-card p-0 text-card-foreground shadow-2xl backdrop:bg-slate-950/55"
        aria-labelledby="add-knowledge-title"
      >
        <div className="flex max-h-[92vh] flex-col">
          <header className="flex items-start justify-between gap-4 border-b px-5 py-4 sm:px-6">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                Knowledge library
              </p>
              <h2
                id="add-knowledge-title"
                className="mt-1 text-xl font-semibold tracking-tight"
              >
                Add Knowledge
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Add content, then choose where it belongs and which bots can use
                it.
              </p>
            </div>
            <button
              type="button"
              onClick={closeDialog}
              className="grid size-11 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Close Add Knowledge dialog"
              disabled={pending || uploading}
            >
              <X size={20} />
            </button>
          </header>

          {!complete ? (
            <>
              <ol className="grid grid-cols-3 border-b bg-muted/45 px-5 py-3 sm:px-6">
                {steps.map((label, index) => {
                  const number = index + 1;
                  const active = step === number;
                  const finished = step > number;
                  return (
                    <li
                      key={label}
                      className={cn(
                        "flex items-center gap-2 text-xs font-medium sm:text-sm",
                        active || finished
                          ? "text-primary"
                          : "text-muted-foreground",
                      )}
                      aria-current={active ? "step" : undefined}
                    >
                      <span
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full border bg-card",
                          (active || finished) &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {finished ? <Check size={15} /> : number}
                      </span>
                      <span className="hidden sm:inline">{label}</span>
                    </li>
                  );
                })}
              </ol>

              <form
                ref={formRef}
                action={action}
                onSubmit={handleSubmit}
                noValidate
                className="min-h-0 flex-1 overflow-y-auto"
              >
                <input type="hidden" name="kind" value={kind} />
                <input type="hidden" name="scope" value={scope} />
                <input type="hidden" name="fileName" value={fileName} />
                <div className="p-5 sm:p-6">
                  {step === 1 ? (
                    <fieldset>
                      <legend className="text-base font-semibold">
                        What would you like to add?
                      </legend>
                      <p className="mt-1 text-sm text-muted-foreground">
                        You can configure access before anything is saved.
                      </p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {kinds.map((item) => {
                          const Icon = item.icon;
                          const selected = kind === item.value;
                          return (
                            <button
                              key={item.value}
                              type="button"
                              onClick={() => {
                                setKind(item.value);
                                setFileName("");
                              }}
                              className={cn(
                                "flex min-h-28 items-start gap-3 rounded-xl border p-4 text-left transition",
                                selected
                                  ? "border-primary bg-secondary ring-2 ring-primary/15"
                                  : "bg-card hover:border-slate-400 hover:bg-muted/40",
                              )}
                              aria-pressed={selected}
                            >
                              <span
                                className={cn(
                                  "grid size-11 shrink-0 place-items-center rounded-xl",
                                  selected
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted text-muted-foreground",
                                )}
                              >
                                <Icon size={21} />
                              </span>
                              <span>
                                <span className="block font-semibold">
                                  {item.title}
                                </span>
                                <span className="mt-1 block text-sm leading-5 text-muted-foreground">
                                  {item.description}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </fieldset>
                  ) : null}

                  <div
                    data-knowledge-details
                    className={cn("space-y-5", step !== 2 && "hidden")}
                    aria-hidden={step !== 2}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid size-10 place-items-center rounded-lg bg-secondary text-secondary-foreground">
                        <ActiveKindIcon size={19} />
                      </span>
                      <div>
                        <h3 className="font-semibold">{activeKind.title}</h3>
                        <p className="text-sm text-muted-foreground">
                          Enter the source details below.
                        </p>
                      </div>
                    </div>
                    <Field
                      label="Knowledge name"
                      htmlFor="knowledge-name"
                      required
                    >
                      <Input
                        id="knowledge-name"
                        name="name"
                        placeholder="e.g. Employee handbook"
                        required
                        minLength={2}
                        maxLength={120}
                      />
                    </Field>
                    {kind === "FILE" ? (
                      <Field
                        label="File"
                        htmlFor="knowledge-file"
                        hint="PDF, DOCX, XLSX, CSV, TXT, Markdown, or HTML"
                        required
                      >
                        <Input
                          id="knowledge-file"
                          type="file"
                          accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm"
                          onChange={(event) => {
                            const file = event.target.files?.[0] ?? null;
                            selectedFileRef.current = file;
                            setFileName(file?.name ?? "");
                          }}
                          required
                        />
                      </Field>
                    ) : null}
                    {kind === "COPIED_TEXT" ? (
                      <>
                        <Field
                          label="Text"
                          htmlFor="knowledge-content"
                          required
                        >
                          <Textarea
                            id="knowledge-content"
                            name="content"
                            rows={9}
                            minLength={20}
                            placeholder="Paste the knowledge you want bots to use…"
                            required
                          />
                        </Field>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Field label="Category" htmlFor="knowledge-category">
                            <Input
                              id="knowledge-category"
                              name="category"
                              placeholder="Policy, Product, Operations…"
                            />
                          </Field>
                          <Field
                            label="Tags"
                            htmlFor="knowledge-tags"
                            hint="Comma separated"
                          >
                            <Input
                              id="knowledge-tags"
                              name="tags"
                              placeholder="policy, onboarding, 2026"
                            />
                          </Field>
                        </div>
                        <Field
                          label="Description"
                          htmlFor="knowledge-description"
                        >
                          <Textarea
                            id="knowledge-description"
                            name="description"
                            rows={2}
                          />
                        </Field>
                      </>
                    ) : null}
                    {kind === "WEB" ? (
                      <>
                        <Field
                          label="Page URL"
                          htmlFor="knowledge-url"
                          required
                        >
                          <Input
                            id="knowledge-url"
                            name="url"
                            type="url"
                            placeholder="https://docs.example.com/handbook"
                            required
                          />
                        </Field>
                        <Field
                          label="Allowed domains"
                          htmlFor="knowledge-domains"
                          hint="One domain per line. Redirects must remain on an allowed public domain."
                          required
                        >
                          <Textarea
                            id="knowledge-domains"
                            name="allowedDomains"
                            rows={3}
                            placeholder="docs.example.com"
                            required
                          />
                        </Field>
                        <input type="hidden" name="timeoutMs" value="15000" />
                        <input type="hidden" name="maxBytes" value="5242880" />
                        <input type="hidden" name="maxRedirects" value="3" />
                        <input
                          type="hidden"
                          name="intervalMinutes"
                          value="360"
                        />
                        <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                          <input name="scheduleEnabled" type="checkbox" />
                          Refresh this page automatically every 6 hours
                        </label>
                      </>
                    ) : null}
                    {kind === "SHARED_FOLDER" ? (
                      <>
                        <fieldset>
                          <legend className="text-sm font-medium">
                            Folder location
                          </legend>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            {[
                              {
                                value: "GOOGLE_DRIVE" as const,
                                title: "Google Drive",
                                description: "Paste a shared folder URL",
                              },
                              {
                                value: "MOUNTED_FOLDER" as const,
                                title: "Mounted folder",
                                description: "Use an approved server path",
                              },
                            ].map((option) => (
                              <label
                                key={option.value}
                                className={cn(
                                  "flex min-h-16 cursor-pointer items-start gap-3 rounded-lg border p-3",
                                  sharedFolderLocation === option.value &&
                                    "border-primary bg-secondary",
                                )}
                              >
                                <input
                                  type="radio"
                                  name="sharedFolderLocation"
                                  value={option.value}
                                  checked={
                                    sharedFolderLocation === option.value
                                  }
                                  onChange={() =>
                                    setSharedFolderLocation(option.value)
                                  }
                                  className="mt-1"
                                />
                                <span>
                                  <span className="block text-sm font-medium">
                                    {option.title}
                                  </span>
                                  <span className="block text-xs text-muted-foreground">
                                    {option.description}
                                  </span>
                                </span>
                              </label>
                            ))}
                          </div>
                        </fieldset>
                        {sharedFolderLocation === "GOOGLE_DRIVE" ? (
                          <Field
                            label="Google Drive folder URL"
                            htmlFor="knowledge-folder-url"
                            hint="Share the folder with the service account, then paste its drive.google.com/drive/folders/… URL."
                            required
                          >
                            <Input
                              id="knowledge-folder-url"
                              name="rootPath"
                              type="url"
                              pattern="https://drive\.google\.com/drive/(u/[0-9]+/)?folders/[A-Za-z0-9_-]+.*"
                              placeholder="https://drive.google.com/drive/folders/…"
                              required
                            />
                          </Field>
                        ) : (
                          <Field
                            label="Pre-mounted folder path"
                            htmlFor="knowledge-folder-path"
                            hint="The folder must be inside an administrator-approved shared root."
                            required
                          >
                            <Input
                              id="knowledge-folder-path"
                              name="rootPath"
                              placeholder="/mnt/knowledge/team-policies"
                              required
                            />
                          </Field>
                        )}
                        {sharedFolderLocation === "GOOGLE_DRIVE" ? (
                          <p
                            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900"
                            role="note"
                          >
                            {googleDriveServiceAccountEmail
                              ? `Share this folder as Viewer with ${googleDriveServiceAccountEmail}.`
                              : "Google Drive is not configured on this server yet. Ask an administrator to add a service account before saving."}
                          </p>
                        ) : null}
                        <input type="hidden" name="maxFiles" value="10000" />
                        <input
                          type="hidden"
                          name="intervalMinutes"
                          value="60"
                        />
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                            <input
                              name="includeSubdirectories"
                              type="checkbox"
                              defaultChecked
                            />
                            Include subfolders
                          </label>
                          <label className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm">
                            <input name="scheduleEnabled" type="checkbox" />
                            Refresh every hour
                          </label>
                        </div>
                      </>
                    ) : null}
                  </div>

                  {step === 3 ? (
                    <div className="space-y-5">
                      <div>
                        <h3 className="text-base font-semibold">
                          Choose where this knowledge belongs
                        </h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          The folder controls governance. Bot access controls
                          who can use it.
                        </p>
                      </div>
                      <Field
                        label="Knowledge folder"
                        htmlFor="knowledge-rack"
                        required
                      >
                        <Select id="knowledge-rack" name="rackId" required>
                          <option value="">Select a folder</option>
                          {folders.map((folder) => (
                            <option key={folder.id} value={folder.id}>
                              {folder.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <fieldset className="rounded-xl border p-4">
                        <legend className="px-1 text-sm font-semibold">
                          Bot access
                        </legend>
                        <div className="mt-2 grid gap-3 sm:grid-cols-2">
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-3",
                              scope === "GLOBAL" &&
                                "border-primary bg-secondary",
                            )}
                          >
                            <input
                              type="radio"
                              name="access-choice"
                              checked={scope === "GLOBAL"}
                              onChange={() => {
                                setScope("GLOBAL");
                                setUploadError(null);
                              }}
                            />
                            <span>
                              <span className="block text-sm font-medium">
                                All bots
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Available wherever folder permissions allow
                              </span>
                            </span>
                          </label>
                          <label
                            className={cn(
                              "flex cursor-pointer gap-3 rounded-lg border p-3",
                              scope === "SELECTED_BOTS" &&
                                "border-primary bg-secondary",
                            )}
                          >
                            <input
                              type="radio"
                              name="access-choice"
                              checked={scope === "SELECTED_BOTS"}
                              onChange={() => setScope("SELECTED_BOTS")}
                            />
                            <span>
                              <span className="block text-sm font-medium">
                                Selected bots
                              </span>
                              <span className="text-xs text-muted-foreground">
                                Limit use to the bots selected below
                              </span>
                            </span>
                          </label>
                        </div>
                        {scope === "SELECTED_BOTS" ? (
                          <div className="mt-4 grid gap-2 sm:grid-cols-2">
                            {bots.map((bot) => (
                              <label
                                key={bot.id}
                                className="flex min-h-11 items-center gap-3 rounded-lg border px-3 text-sm"
                              >
                                <input
                                  type="checkbox"
                                  name="botIds"
                                  value={bot.id}
                                  onChange={() => setUploadError(null)}
                                />
                                {bot.name}
                              </label>
                            ))}
                            {!bots.length ? (
                              <p className="text-sm text-muted-foreground sm:col-span-2">
                                No bots are available. Choose All bots or create
                                a bot first.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </fieldset>
                      {!folders.length ? (
                        <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                          Create a Knowledge Folder before adding knowledge.
                        </p>
                      ) : null}
                      {state && !state.ok ? (
                        <p role="alert" className="text-sm text-destructive">
                          {state.error.message}
                        </p>
                      ) : null}
                      {uploadError ? (
                        <p role="alert" className="text-sm text-destructive">
                          {uploadError}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <footer className="sticky bottom-0 flex items-center justify-between gap-3 border-t bg-card px-5 py-4 sm:px-6">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setStep((current) => Math.max(1, current - 1))
                    }
                    disabled={step === 1 || pending || uploading}
                  >
                    <ChevronLeft size={18} /> Back
                  </Button>
                  {step < 3 ? (
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.preventDefault();
                        nextStep();
                      }}
                    >
                      Continue <ChevronRight size={18} />
                    </Button>
                  ) : uploadError && state?.ok && state.data.uploadRequired ? (
                    <Button
                      type="button"
                      onClick={() => void uploadSelectedFile(state.data.id)}
                      disabled={uploading}
                    >
                      {uploading ? "Uploading…" : "Retry upload"}
                    </Button>
                  ) : (
                    <Button
                      type="submit"
                      disabled={pending || uploading || !folders.length}
                    >
                      {pending || uploading
                        ? uploading
                          ? "Uploading…"
                          : "Creating…"
                        : "Add Knowledge"}
                    </Button>
                  )}
                </footer>
              </form>
            </>
          ) : (
            <div className="grid place-items-center px-6 py-14 text-center">
              <span className="grid size-14 place-items-center rounded-full bg-emerald-100 text-emerald-700">
                <Check size={28} />
              </span>
              <h3 className="mt-4 text-lg font-semibold">Knowledge added</h3>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                It is now being prepared and will appear in All knowledge with
                the access you selected.
              </p>
              <Button className="mt-6" onClick={closeDialog}>
                Done
              </Button>
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
