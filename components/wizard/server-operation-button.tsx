"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ServerOperationButton({
  endpoint,
  children,
  onSuccess,
}: {
  endpoint: string;
  children: React.ReactNode;
  onSuccess?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [technicalDetails, setTechnicalDetails] = useState<{
    code: string;
    requestId: string;
    diagnostics?: Record<string, string | number | boolean | null>;
  }>();
  const [compatibilityWarning, setCompatibilityWarning] = useState<string>();
  const [success, setSuccess] = useState(false);
  async function run() {
    setPending(true);
    setMessage(undefined);
    setTechnicalDetails(undefined);
    setCompatibilityWarning(undefined);
    setSuccess(false);
    try {
      const response = await fetch(endpoint, { method: "POST" });
      const result = await response.json();
      if (!result.ok) {
        setMessage(result.error.message);
        setTechnicalDetails({
          code: result.error.code,
          requestId: result.error.requestId,
          diagnostics: result.error.diagnostics,
        });
      } else {
        setSuccess(true);
        setMessage(
          endpoint.endsWith("/test")
            ? `Connection succeeded in ${result.data.latencyMs} ms${result.data.serverVersion ? ` · ${result.data.serverVersion}` : ""}.`
            : `Discovered ${result.data.tables} tables and ${result.data.columns} columns.`,
        );
        setCompatibilityWarning(result.data.compatibilityWarning);
        onSuccess?.();
        router.refresh();
      }
    } catch {
      setMessage("The request could not be completed. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <Button type="button" onClick={run} disabled={pending}>
        {pending ? (
          <LoaderCircle size={18} className="animate-spin" />
        ) : (
          <RefreshCw size={17} />
        )}
        {pending ? "Working…" : children}
      </Button>
      {message ? (
        <p
          className={`mt-3 text-sm ${success ? "text-success" : "text-destructive"}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      ) : null}
      {compatibilityWarning ? (
        <p
          className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
          role="status"
        >
          {compatibilityWarning}
        </p>
      ) : null}
      {technicalDetails ? (
        <details className="mt-3 rounded-lg border bg-slate-50 text-sm">
          <summary className="min-h-10 cursor-pointer px-3 py-2 font-medium text-slate-700">
            Technical details
          </summary>
          <dl className="grid gap-2 border-t px-3 py-3 font-mono text-xs">
            <Detail label="Application code" value={technicalDetails.code} />
            <Detail label="Request ID" value={technicalDetails.requestId} />
            {Object.entries(technicalDetails.diagnostics ?? {}).map(
              ([label, value]) => (
                <Detail key={label} label={label} value={String(value)} />
              ),
            )}
          </dl>
          <p className="border-t px-3 py-2 text-xs text-muted-foreground">
            Secrets, connection strings, and stack traces are intentionally
            excluded. Use the request ID to correlate this error with the server
            log.
          </p>
        </details>
      ) : null}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="break-all text-slate-900">{value}</dd>
    </div>
  );
}
