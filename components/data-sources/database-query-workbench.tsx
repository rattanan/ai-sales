"use client";

import { useActionState } from "react";
import {
  cancelDatabaseQueryAction,
  executeDatabaseQueryAction,
  proposeDatabaseQueryAction,
} from "@/features/data-sources/actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

type Proposal = {
  id: string;
  status: string;
  clarification?: string | null;
  sql?: string | null;
  explanation?: string;
  referencedTables?: string[];
};

type Execution = {
  id: string;
  status: string;
  summary: string;
  limitations: string[];
  previewRows: Array<Record<string, unknown>>;
  rowCount: number;
  durationMs: number;
  citation: {
    connectionName: string;
    engine: string;
    tables: string[];
    executedAt: string;
  };
};

type State<T> =
  | { ok: true; data: T }
  | { ok: false; error: { message: string; requestId: string } }
  | null;

function ErrorMessage<T>({ state }: { state: State<T> }) {
  if (!state || state.ok) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {state.error.message}
    </p>
  );
}

export function DatabaseQueryWorkbench({
  dataSourceId,
  sourceName,
}: {
  dataSourceId: string;
  sourceName: string;
}) {
  const [proposalState, propose, proposing] = useActionState(
    proposeDatabaseQueryAction,
    null,
  ) as [State<Proposal>, (payload: FormData) => void, boolean];
  const [executionState, execute, executing] = useActionState(
    executeDatabaseQueryAction,
    null,
  ) as [State<Execution>, (payload: FormData) => void, boolean];
  const [cancelState, cancel, cancelling] = useActionState(
    cancelDatabaseQueryAction,
    null,
  ) as [
    State<{ id: string; status: "CANCELLED" }>,
    (payload: FormData) => void,
    boolean,
  ];
  const proposal = proposalState?.ok ? proposalState.data : null;
  const execution = executionState?.ok ? executionState.data : null;
  const columns = execution?.previewRows.length
    ? Object.keys(execution.previewRows[0])
    : [];
  return (
    <div className="space-y-6">
      <form
        action={propose}
        className="space-y-4 rounded-xl border bg-card p-5"
      >
        <input type="hidden" name="dataSourceId" value={dataSourceId} />
        <Field
          label={`Ask ${sourceName}`}
          htmlFor="database-question"
          required
          hint="Ask a precise metric question. The system will request clarification when material details are missing."
        >
          <textarea
            id="database-question"
            name="question"
            required
            minLength={3}
            maxLength={2000}
            className="min-h-32 w-full rounded-lg border bg-background p-3 text-sm"
            placeholder="เช่น ยอดขายรวมรายเดือนในปี 2026 แยกตามภูมิภาค"
          />
        </Field>
        <ErrorMessage state={proposalState} />
        <Button disabled={proposing}>
          {proposing ? "Validating question…" : "Generate read-only query"}
        </Button>
      </form>

      {proposal?.status === "CLARIFICATION_REQUIRED" ? (
        <section
          aria-live="polite"
          className="rounded-xl border border-amber-200 bg-amber-50 p-5"
        >
          <h2 className="font-semibold text-amber-950">
            Clarification required
          </h2>
          <p className="mt-2 text-sm text-amber-900">
            {proposal.clarification}
          </p>
        </section>
      ) : null}

      {proposal?.status === "READY_FOR_REVIEW" && proposal.sql ? (
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <div>
            <h2 className="font-semibold">Validated execution plan</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {proposal.explanation}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {proposal.referencedTables?.map((table) => (
              <span
                key={table}
                className="rounded-full bg-muted px-3 py-1 text-xs"
              >
                {table}
              </span>
            ))}
          </div>
          <pre className="max-h-80 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-50">
            <code>{proposal.sql}</code>
          </pre>
          <form action={execute} className="space-y-3">
            <input type="hidden" name="id" value={proposal.id} />
            <ErrorMessage state={executionState} />
            <Button disabled={executing}>
              {executing
                ? "Executing with safety limits…"
                : "Approve and execute"}
            </Button>
          </form>
          <form action={cancel} className="space-y-3">
            <input type="hidden" name="id" value={proposal.id} />
            <ErrorMessage state={cancelState} />
            {cancelState?.ok ? (
              <p role="status" className="text-sm text-muted-foreground">
                Query cancelled.
              </p>
            ) : null}
            <Button
              type="submit"
              variant="outline"
              disabled={cancelling || !executing}
            >
              {cancelling ? "Cancelling…" : "Cancel running query"}
            </Button>
          </form>
        </section>
      ) : null}

      {execution ? (
        <section
          aria-live="polite"
          className="space-y-5 rounded-xl border bg-card p-5"
        >
          <div>
            <h2 className="font-semibold">Grounded result</h2>
            <p className="mt-2 whitespace-pre-wrap text-sm">
              {execution.summary}
            </p>
          </div>
          {execution.limitations.length ? (
            <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
              {execution.limitations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {columns.length ? (
            <div className="overflow-x-auto rounded-lg border">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-muted">
                  <tr>
                    {columns.map((column) => (
                      <th key={column} className="px-3 py-2 font-medium">
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {execution.previewRows.map((row, index) => (
                    <tr key={index}>
                      {columns.map((column) => (
                        <td
                          key={column}
                          className="max-w-80 px-3 py-2 align-top"
                        >
                          <span className="line-clamp-4 break-words">
                            {row[column] == null ? "—" : String(row[column])}
                          </span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
            <p>
              {execution.citation.connectionName} · {execution.citation.engine}
            </p>
            <p>{execution.citation.tables.join(", ")}</p>
            <p>
              {execution.rowCount} rows · {execution.durationMs} ms ·{" "}
              {new Date(execution.citation.executedAt).toLocaleString()}
            </p>
          </div>
        </section>
      ) : null}
    </div>
  );
}
