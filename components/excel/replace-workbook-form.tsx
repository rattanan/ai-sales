"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function ReplaceWorkbookForm({
  dataSourceId,
}: {
  dataSourceId: string;
}) {
  const [message, setMessage] = useState<string>();
  const [pending, setPending] = useState(false);
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setMessage(undefined);
        const response = await fetch(
          `/api/data-sources/${dataSourceId}/excel-versions`,
          { method: "POST", body: new FormData(event.currentTarget) },
        );
        const result = await response.json();
        setPending(false);
        if (result.ok) {
          setMessage(
            `Version ${result.data.version} imported. Reload to review schema changes.`,
          );
          event.currentTarget.reset();
        } else setMessage(result.error?.message ?? "Import failed.");
      }}
    >
      <label className="flex-1 text-sm font-medium">
        Replace workbook
        <input
          className="mt-2 block min-h-11 w-full rounded-lg border bg-white px-3 py-2"
          type="file"
          name="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          required
        />
      </label>
      <Button disabled={pending}>
        {pending ? "Importing…" : "Upload new version"}
      </Button>
      {message ? (
        <p role="status" className="text-sm text-muted-foreground sm:max-w-xs">
          {message}
        </p>
      ) : null}
    </form>
  );
}
