"use client";

import { useState } from "react";
import { CheckCircle2, DatabaseZap, LoaderCircle, X } from "lucide-react";
import type { NtopSuggestedAction } from "@/schemas/ntop";
import { Button } from "@/components/ui/button";

export function NtopActionCard({ action }: { action: NtopSuggestedAction }) {
  const [status, setStatus] = useState(action.status);
  const [error, setError] = useState(action.errorMessage ?? "");
  const busy = status === "EXECUTING";

  async function execute(operation: "confirm" | "cancel") {
    if (busy) return;
    setError("");
    if (operation === "confirm") setStatus("EXECUTING");
    try {
      const response = await fetch(
        `/api/ntop/actions/${encodeURIComponent(action.id)}/${operation}`,
        { method: "POST" },
      );
      const payload = (await response.json()) as {
        data?: { status?: NtopSuggestedAction["status"] };
        message?: string;
      };
      if (!response.ok)
        throw new Error(
          payload.message ?? "NTOP could not complete the action.",
        );
      setStatus(
        payload.data?.status ??
          (operation === "confirm" ? "COMPLETED" : "CANCELLED"),
      );
    } catch (caught) {
      setStatus("FAILED");
      setError(
        caught instanceof Error
          ? caught.message
          : "NTOP could not complete the action.",
      );
    }
  }

  return (
    <section
      className="mt-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm"
      aria-label="Suggested NTOP action"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-blue-100 text-blue-700">
          <DatabaseZap size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-blue-950">{action.title}</p>
          <p className="mt-1 text-blue-900">{action.summary}</p>
          <p className="mt-2 text-xs text-blue-700">
            Write action · Requires your confirmation · No automatic creation
          </p>
        </div>
      </div>
      {status === "PENDING" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            onClick={() => void execute("confirm")}
          >
            Confirm in NTOP
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void execute("cancel")}
          >
            <X size={15} /> Cancel
          </Button>
        </div>
      ) : status === "EXECUTING" ? (
        <p
          className="mt-4 flex items-center gap-2 font-medium text-blue-800"
          role="status"
        >
          <LoaderCircle className="animate-spin" size={16} /> Saving to NTOP…
        </p>
      ) : status === "COMPLETED" ? (
        <p className="mt-4 flex items-center gap-2 font-medium text-emerald-700">
          <CheckCircle2 size={16} /> Saved to NTOP
        </p>
      ) : (
        <p
          className={`mt-4 font-medium ${status === "CANCELLED" ? "text-slate-600" : "text-red-700"}`}
        >
          {status === "CANCELLED"
            ? "Action cancelled"
            : error || `Action ${status.toLowerCase()}`}
        </p>
      )}
    </section>
  );
}
