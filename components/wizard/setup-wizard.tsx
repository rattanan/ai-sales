"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  FileSpreadsheet,
  Gauge,
  LoaderCircle,
  LockKeyhole,
  Network,
  Server,
  Sparkles,
  Table2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import { ServerOperationButton } from "./server-operation-button";
import {
  createDatabaseDataSourceAction,
  saveDataScopeAction,
  updateDatabaseDataSourceAction,
} from "@/features/data-sources/actions";

type SourceType = "MYSQL" | "POSTGRESQL" | "MSSQL" | "ORACLE" | "EXCEL";
type WizardSource = {
  id: string;
  name: string;
  type: SourceType;
  status: string;
  host?: string | null;
  port?: number | null;
  databaseName?: string | null;
  username?: string | null;
  sslEnabled: boolean;
  connectionOptions?: Record<string, unknown>;
  fileName?: string;
  sheetNames?: string[];
  schemas: {
    id: string;
    name: string;
    tables: {
      id: string;
      name: string;
      tableType: string;
      selected: boolean;
      estimatedRows: string | null;
    }[];
  }[];
};
const steps = ["Welcome", "Source", "Details", "Test", "Scope"];
const sourceOptions: {
  type: SourceType;
  title: string;
  description: string;
  live: boolean;
  icon: React.ReactNode;
}[] = [
  {
    type: "MYSQL",
    title: "MySQL",
    description: "Live connection testing and metadata discovery.",
    live: true,
    icon: <Database />,
  },
  {
    type: "POSTGRESQL",
    title: "PostgreSQL",
    description: "Adapter prepared; live support follows Phase 0.",
    live: false,
    icon: <Server />,
  },
  {
    type: "MSSQL",
    title: "Microsoft SQL Server",
    description: "Adapter prepared; live support follows Phase 0.",
    live: false,
    icon: <Network />,
  },
  {
    type: "ORACLE",
    title: "Oracle Database",
    description: "Read-only Thin mode connection, discovery, and previews.",
    live: true,
    icon: <Gauge />,
  },
  {
    type: "EXCEL",
    title: "Excel workbook",
    description: "Upload and detect workbook sheets.",
    live: true,
    icon: <FileSpreadsheet />,
  },
];
const defaultPorts: Record<Exclude<SourceType, "EXCEL">, number> = {
  MYSQL: 3306,
  POSTGRESQL: 5432,
  MSSQL: 1433,
  ORACLE: 1521,
};

export function SetupWizard({
  initialStep,
  initialType,
  source,
}: {
  initialStep: number;
  initialType?: SourceType;
  source?: WizardSource;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string>();
  const [selectedType, setSelectedType] = useState<SourceType>(
    source?.type ?? initialType ?? "MYSQL",
  );
  const [oracleConnectionType, setOracleConnectionType] = useState<
    "service_name" | "sid"
  >("service_name");
  const [autoPrioritizeTables, setAutoPrioritizeTables] = useState(
    source?.type === "ORACLE",
  );
  const [selectedTables, setSelectedTables] = useState(
    () =>
      new Set(
        source?.schemas.flatMap((schema) =>
          schema.tables
            .filter((table) => table.selected)
            .map((table) => table.id),
        ) ?? [],
      ),
  );
  const connectionForm = useRef<HTMLFormElement>(null);
  const step = Math.min(Math.max(initialStep, 1), steps.length);
  const query = useMemo(
    () => ({ id: source?.id, type: selectedType }),
    [source?.id, selectedType],
  );
  const allTableIds =
    source?.schemas.flatMap((schema) =>
      schema.tables.map((table) => table.id),
    ) ?? [];
  function go(next: number, overrides?: Record<string, string | undefined>) {
    const params = new URLSearchParams({
      step: String(next),
      type: selectedType,
    });
    const merged = { ...query, ...overrides };
    if (merged.id) params.set("id", merged.id);
    router.push(`/workspace/data-sources/new?${params}`);
  }
  function run(task: () => Promise<void>) {
    setMessage(undefined);
    startTransition(
      () =>
        void task().catch(() =>
          setMessage("The operation could not be completed. Try again."),
        ),
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-7">
        <div className="mb-3 flex items-center justify-between text-xs font-medium text-muted-foreground">
          <span>Step {step} of {steps.length}</span>
          <span>{steps[step - 1]}</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={steps.length}
          aria-valuenow={step}
          aria-label={`Step ${step} of ${steps.length}`}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-200"
            style={{ width: `${(step / steps.length) * 100}%` }}
          />
        </div>
        <ol className="mt-4 hidden grid-cols-5 gap-2 lg:grid">
          {steps.map((label, index) => (
            <li
              key={label}
              className={`text-center text-xs ${index + 1 === step ? "font-semibold text-primary" : index + 1 < step ? "text-slate-700" : "text-slate-400"}`}
            >
              {label}
            </li>
          ))}
        </ol>
      </div>
      {step === 1 ? (
        <StepCard
          icon={<Sparkles />}
          title="Create an AI-ready data source"
          description="This guided setup securely connects your data, verifies access, discovers its structure, and saves the governed scope available to AI features."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Trust
              icon={<LockKeyhole />}
              title="Credentials encrypted"
              text="Secrets stay on the server."
            />
            <Trust
              icon={<Table2 />}
              title="Metadata scoped"
              text="Choose only relevant data."
            />
            <Trust
              icon={<CheckCircle2 />}
              title="Governed scope"
              text="Finish after selecting tables."
            />
          </div>
          <Footer onNext={() => go(2)} />
        </StepCard>
      ) : null}
      {step === 2 ? (
        <StepCard
          icon={<Database />}
          title="Select a data source"
          description="Live database connections use encrypted server-side credentials and read-only access."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sourceOptions.map((option) => (
              <button
                key={option.type}
                type="button"
                onClick={() => setSelectedType(option.type)}
                aria-pressed={selectedType === option.type}
                className={`min-h-44 cursor-pointer rounded-xl border p-5 text-left transition-colors ${selectedType === option.type ? "border-primary bg-blue-50 ring-2 ring-blue-100" : "bg-card hover:border-slate-400"}`}
              >
                <div className="flex items-start justify-between">
                  <span
                    className={`grid size-11 place-items-center rounded-lg ${selectedType === option.type ? "bg-primary text-white" : "bg-slate-100 text-slate-700"}`}
                  >
                    {option.icon}
                  </span>
                  {selectedType === option.type ? (
                    <CheckCircle2 className="text-primary" size={20} />
                  ) : null}
                </div>
                <h3 className="mt-4 font-semibold">{option.title}</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  {option.description}
                </p>
                <Badge
                  className="mt-3"
                  tone={option.live ? "success" : "neutral"}
                >
                  {option.live ? "Phase 0 available" : "Prepared"}
                </Badge>
              </button>
            ))}
          </div>
          <Footer onBack={() => go(1)} onNext={() => go(3)} />
        </StepCard>
      ) : null}
      {step === 3 ? (
        <StepCard
          icon={selectedType === "EXCEL" ? <FileSpreadsheet /> : <Server />}
          title={
            selectedType === "EXCEL"
              ? "Upload an Excel workbook"
              : "Enter connection details"
          }
          description={
            selectedType === "EXCEL"
              ? "The workbook is parsed server-side and stored through the configured storage adapter."
              : "The password is encrypted immediately and is never returned to this browser."
          }
        >
          {selectedType === "EXCEL" ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                run(async () => {
                  const response = await fetch(
                    "/api/data-sources/excel-upload",
                    { method: "POST", body: new FormData(form) },
                  );
                  const result = await response.json();
                  if (!result.ok) return setMessage(result.error.message);
                  form.reset();
                  go(4, { id: result.data.id });
                });
              }}
              className="space-y-5"
            >
              <Field label="Connection name" htmlFor="excel-name" required>
                <Input
                  id="excel-name"
                  name="name"
                  placeholder="Monthly finance workbook"
                  required
                />
              </Field>
              <Field
                label="Workbook"
                htmlFor="file"
                required
                hint=".xlsx or .xls, up to the configured upload limit."
              >
                <Input
                  id="file"
                  name="file"
                  type="file"
                  accept=".xlsx,.xls"
                  required
                  className="file:mr-4 file:rounded-md file:border-0 file:bg-secondary file:px-3 file:py-1.5 file:font-medium file:text-secondary-foreground"
                />
              </Field>
              <Button disabled={pending}>
                {pending ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : null}
                Upload workbook
              </Button>
            </form>
          ) : (
            <form
              ref={connectionForm}
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const values = new FormData(form);
                let options = {};
                try {
                  options = JSON.parse(
                    String(values.get("connectionOptions") || "{}"),
                  );
                } catch {
                  return setMessage(
                    "Advanced connection parameters must be valid JSON.",
                  );
                }
                run(async () => {
                  const payload = {
                    type: selectedType,
                    name: values.get("name"),
                    host: values.get("host"),
                    port: values.get("port"),
                    databaseName: values.get("databaseName") || undefined,
                    username: values.get("username"),
                    password: values.get("password"),
                    sslEnabled: values.get("sslEnabled") === "on",
                    connectionOptions: options,
                    connectionType: values.get("connectionType"),
                    serviceName: values.get("serviceName") || undefined,
                    sid: values.get("sid") || undefined,
                    schema: values.get("schema") || undefined,
                    sslMode: values.get("sslMode"),
                    connectionTimeoutMs: values.get("connectionTimeoutMs"),
                  };
                  const result = source?.id
                    ? await updateDatabaseDataSourceAction({
                        ...payload,
                        dataSourceId: source.id,
                      })
                    : await createDatabaseDataSourceAction(payload);
                  if (!result.ok) return setMessage(result.error.message);
                  go(4, { id: result.data.id });
                });
              }}
              className="grid gap-5 sm:grid-cols-2"
            >
              <Field
                label="Connection name"
                htmlFor="name"
                required
                className="sm:col-span-2"
              >
                <Input
                  id="name"
                  name="name"
                  placeholder="Production reporting"
                  defaultValue={source?.name}
                  required
                />
              </Field>
              <Field label="Host" htmlFor="host" required>
                <Input
                  id="host"
                  name="host"
                  placeholder="db.example.internal"
                  defaultValue={source?.host ?? ""}
                  required
                />
              </Field>
              <Field label="Port" htmlFor="port" required>
                <Input
                  id="port"
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={
                    source?.port ??
                    defaultPorts[selectedType as Exclude<SourceType, "EXCEL">]
                  }
                  required
                />
              </Field>
              {selectedType === "ORACLE" ? (
                <>
                  <Field label="Connection type" htmlFor="connectionType">
                    <select
                      id="connectionType"
                      name="connectionType"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={oracleConnectionType}
                      onChange={(event) =>
                        setOracleConnectionType(
                          event.target.value as "service_name" | "sid",
                        )
                      }
                    >
                      <option value="service_name">Service Name</option>
                      <option value="sid">SID</option>
                    </select>
                  </Field>
                  {oracleConnectionType === "service_name" ? (
                    <Field label="Service Name" htmlFor="serviceName" required>
                      <Input
                        id="serviceName"
                        name="serviceName"
                        placeholder="ORCLPDB1"
                        defaultValue={source?.databaseName ?? ""}
                        required
                      />
                    </Field>
                  ) : (
                    <Field label="SID" htmlFor="sid" required>
                      <Input id="sid" name="sid" placeholder="ORCL" required />
                    </Field>
                  )}
                  <Field
                    label="Default schema"
                    htmlFor="schema"
                    hint="Optional; defaults to the connected user."
                  >
                    <Input id="schema" name="schema" placeholder="REPORTING" />
                  </Field>
                  <Field label="SSL/TLS mode" htmlFor="sslMode">
                    <select
                      id="sslMode"
                      name="sslMode"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                      defaultValue="disable"
                    >
                      <option value="disable">Disable</option>
                      <option value="prefer">Prefer</option>
                      <option value="require">Require</option>
                    </select>
                  </Field>
                  <Field
                    label="Connection timeout (ms)"
                    htmlFor="connectionTimeoutMs"
                  >
                    <Input
                      id="connectionTimeoutMs"
                      name="connectionTimeoutMs"
                      type="number"
                      min={1000}
                      max={60000}
                      defaultValue={15000}
                    />
                  </Field>
                </>
              ) : (
                <Field label="Database name" htmlFor="databaseName" required>
                  <Input
                    id="databaseName"
                    name="databaseName"
                    defaultValue={source?.databaseName ?? ""}
                    required
                  />
                </Field>
              )}
              <Field label="Username" htmlFor="username" required>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  defaultValue={source?.username ?? ""}
                  required
                />
              </Field>
              <Field
                label="Password"
                htmlFor="password"
                required={!source?.id}
                hint={
                  source?.id
                    ? "Leave blank to keep the current encrypted password."
                    : "Cleared from the form immediately after saving."
                }
              >
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required={!source?.id}
                />
              </Field>
              <div className="flex items-center gap-3 pt-6">
                <input
                  id="sslEnabled"
                  name="sslEnabled"
                  type="checkbox"
                  className="size-5 accent-primary"
                  defaultChecked={source?.sslEnabled}
                />
                <label htmlFor="sslEnabled" className="text-sm font-medium">
                  Use TLS/SSL
                </label>
              </div>
              <details className="sm:col-span-2 rounded-lg border">
                <summary className="min-h-11 cursor-pointer px-4 py-3 text-sm font-medium">
                  Advanced connection parameters
                </summary>
                <div className="border-t p-4">
                  <Field
                    label="Parameters as JSON"
                    htmlFor="connectionOptions"
                    hint='Example: {"timezone":"Z"}'
                  >
                    <Textarea
                      id="connectionOptions"
                      name="connectionOptions"
                      className="font-mono text-xs"
                      defaultValue={JSON.stringify(
                        source?.connectionOptions ?? {},
                        null,
                        2,
                      )}
                    />
                  </Field>
                </div>
              </details>
              {selectedType === "ORACLE" ? (
                <p className="sm:col-span-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  Use a dedicated Oracle read-only account with SELECT
                  permissions only on approved schemas, tables, or views.
                </p>
              ) : null}
              {selectedType === "ORACLE" ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={() => {
                    const form = connectionForm.current;
                    if (!form || !form.reportValidity()) return;
                    const values = new FormData(form);
                    run(async () => {
                      const response = await fetch("/api/data-sources/test", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          type: "ORACLE",
                          config: Object.fromEntries(values),
                        }),
                      });
                      const result = await response.json();
                      setMessage(
                        result.ok
                          ? `Connection successful (${result.data.latencyMs} ms; schema ${result.data.currentSchema || "default"}).`
                          : result.error.message,
                      );
                    });
                  }}
                >
                  Test connection
                </Button>
              ) : null}
              <Button disabled={pending} className="sm:col-span-2 sm:w-fit">
                {pending ? (
                  <LoaderCircle className="animate-spin" size={18} />
                ) : null}
                {source?.id ? "Update connection" : "Encrypt and save"}
              </Button>
            </form>
          )}
          {message ? (
            <p className="mt-4 text-sm text-destructive" role="alert">
              {message}
            </p>
          ) : null}
          <Footer onBack={() => go(2)} />
        </StepCard>
      ) : null}
      {step === 4 && source ? (
        <StepCard
          icon={<Network />}
          title={
            source.type === "EXCEL" ? "Workbook ready" : "Test the connection"
          }
          description={
            source.type === "MYSQL" || source.type === "ORACLE"
              ? "A short-lived server connection will verify these credentials. No raw error or secret is returned."
              : source.type === "EXCEL"
                ? "The workbook was stored and its sheet names were detected."
                : "This adapter is intentionally not connected in Phase 0."
          }
        >
          <ConnectionSummary source={source} />
          {source.type === "MYSQL" || source.type === "ORACLE" ? (
            <ServerOperationButton
              endpoint={`/api/data-sources/${source.id}/test`}
            >
              Test connection
            </ServerOperationButton>
          ) : source.type === "EXCEL" ? (
            <p className="flex items-center gap-2 text-sm font-medium text-success">
              <CheckCircle2 size={18} />
              {source.sheetNames?.length ?? 0} sheets detected
            </p>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              {source.type} connectivity is planned for a later phase. The data
              source remains a draft and no success is simulated.
            </div>
          )}
          <Footer
            onBack={() => go(3)}
            onNext={() => go(5)}
            nextDisabled={
              (source.type === "MYSQL" || source.type === "ORACLE") &&
              source.status !== "CONNECTED"
            }
            nextLabel={
              source.type !== "MYSQL" && source.type !== "ORACLE"
                ? "Continue with prepared integration"
                : undefined
            }
          />
        </StepCard>
      ) : null}
      {step === 5 && source ? (
        <StepCard
          icon={<Table2 />}
          title="Select data scope"
          description="Choose the governed tables and views available to AI features. Discovery reads only database metadata."
        >
          {source.type === "MYSQL" || source.type === "ORACLE" ? (
            <>
              {source.type === "ORACLE" ? (
                <label className="mb-5 flex cursor-pointer items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-950">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-5 accent-primary"
                    checked={autoPrioritizeTables}
                    onChange={(event) =>
                      setAutoPrioritizeTables(event.target.checked)
                    }
                  />
                  <span>
                    <strong>Let AI prioritize important tables</strong>
                    <span className="mt-1 block text-blue-800">
                      AI features will rank discovered Oracle objects using
                      relationships, columns, and metadata. Turn this off to
                      choose the scope yourself.
                    </span>
                  </span>
                </label>
              ) : null}
              {source.type === "ORACLE" && autoPrioritizeTables ? (
                <div className="rounded-lg border border-dashed bg-slate-50 p-6 text-sm text-muted-foreground">
                  AI prioritization is enabled. All discovered objects will be
                  available to the analysis, while only the most relevant ones
                  are included in its bounded context.
                </div>
              ) : source.schemas.length ? (
                <div className="space-y-3">
                  {source.schemas.map((schema) => (
                    <details key={schema.id} open className="rounded-lg border">
                      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold">
                        <span>{schema.name}</span>
                        <Badge>{schema.tables.length} objects</Badge>
                      </summary>
                      <div className="divide-y border-t">
                        {schema.tables.map((table) => (
                          <label
                            key={table.id}
                            className="flex min-h-12 cursor-pointer items-center gap-3 px-4 hover:bg-muted"
                          >
                            <input
                              type="checkbox"
                              className="size-5 accent-primary"
                              checked={selectedTables.has(table.id)}
                              onChange={(event) =>
                                setSelectedTables((current) => {
                                  const next = new Set(current);
                                  if (event.target.checked) next.add(table.id);
                                  else next.delete(table.id);
                                  return next;
                                })
                              }
                            />
                            <span className="flex-1 text-sm font-medium">
                              {table.name}
                            </span>
                            <Badge>{table.tableType}</Badge>
                            <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                              {table.estimatedRows
                                ? `${Number(table.estimatedRows).toLocaleString()} est. rows`
                                : "Rows unknown"}
                            </span>
                          </label>
                        ))}
                      </div>
                    </details>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-dashed p-6">
                  <p className="text-sm text-muted-foreground">
                    Discover metadata before selecting tables.
                  </p>
                  <div className="mt-4">
                    <ServerOperationButton
                      endpoint={`/api/data-sources/${source.id}/discover`}
                    >
                      Discover metadata
                    </ServerOperationButton>
                  </div>
                </div>
              )}
              {source.schemas.length &&
              !(source.type === "ORACLE" && autoPrioritizeTables) ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedTables(new Set(allTableIds))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setSelectedTables(new Set())}
                  >
                    Clear all
                  </Button>
                </div>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="mt-5"
                disabled={pending || !source.schemas.length}
                onClick={() =>
                  run(async () => {
                    const result = await saveDataScopeAction(
                      source.id,
                      [
                        ...(source.type === "ORACLE" && autoPrioritizeTables
                          ? allTableIds
                          : selectedTables),
                      ],
                      autoPrioritizeTables,
                    );
                    if (!result.ok) return setMessage(result.error.message);
                    router.push(`/workspace/data-sources/${source.id}`);
                  })
                }
              >
                {pending ? (
                  <LoaderCircle size={18} className="animate-spin" />
                ) : (
                  <Check size={17} />
                )}
                Save scope and finish
              </Button>
            </>
          ) : source.type === "EXCEL" ? (
            <div className="space-y-2">
              {source.sheetNames?.map((sheet) => (
                <div
                  key={sheet}
                  className="flex min-h-11 items-center gap-3 rounded-lg border px-4"
                >
                  <FileSpreadsheet size={17} className="text-success" />
                  <span className="text-sm font-medium">{sheet}</span>
                  <Badge tone="success" className="ml-auto">
                    Detected
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
              Metadata discovery is unavailable for this prepared connector.
            </div>
          )}
          {message ? (
            <p className="mt-3 text-sm text-destructive">{message}</p>
          ) : null}
          <Footer
            onBack={() => go(4)}
            onNext={
              source.type === "MYSQL" || source.type === "ORACLE"
                ? undefined
                : () => router.push(`/workspace/data-sources/${source.id}`)
            }
            nextLabel="Finish setup"
          />
        </StepCard>
      ) : null}
      {step > 3 && !source ? (
        <MissingState
          go={() => go(2)}
          label="The setup link is missing its data source. Select a source to continue."
        />
      ) : null}
    </div>
  );
}

function StepCard({
  icon,
  title,
  description,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="border-b p-6">
        <div className="flex gap-4">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-secondary text-primary">
            {icon}
          </span>
          <div>
            <CardTitle className="text-xl sm:text-2xl">{title}</CardTitle>
            <CardDescription className="max-w-3xl leading-6">
              {description}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-6">{children}</CardContent>
    </Card>
  );
}
function Footer({
  onBack,
  onNext,
  nextDisabled,
  nextLabel,
}: {
  onBack?: () => void;
  onNext?: () => void;
  nextDisabled?: boolean;
  nextLabel?: string;
}) {
  return (
    <div className="mt-7 flex justify-between border-t pt-5">
      {onBack ? (
        <Button variant="outline" onClick={onBack}>
          <ArrowLeft size={17} />
          Back
        </Button>
      ) : (
        <span />
      )}
      {onNext ? (
        <Button onClick={onNext} disabled={nextDisabled}>
          {nextLabel || "Continue"}
          <ArrowRight size={17} />
        </Button>
      ) : null}
    </div>
  );
}
function Trust({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 p-4">
      <span className="text-primary">{icon}</span>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  );
}
function ConnectionSummary({ source }: { source: WizardSource }) {
  return (
    <div className="mb-6 grid gap-3 rounded-xl border bg-slate-50 p-4 sm:grid-cols-2">
      <SummaryItem label="Connection" value={source.name} />
      <SummaryItem label="Type" value={source.type} />
      <SummaryItem
        label={source.type === "EXCEL" ? "File" : "Host"}
        value={source.fileName || source.host || "—"}
      />
      <SummaryItem label="Status" value={source.status} />
    </div>
  );
}
function SummaryItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-slate-50 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm font-semibold capitalize">
        {value.toLowerCase()}
      </p>
    </div>
  );
}
function MissingState({ go, label }: { go: () => void; label: string }) {
  return (
    <Card>
      <CardContent className="p-8 text-center">
        <p className="text-sm text-muted-foreground">{label}</p>
        <Button className="mt-5" onClick={go}>
          Return to setup
        </Button>
      </CardContent>
    </Card>
  );
}
