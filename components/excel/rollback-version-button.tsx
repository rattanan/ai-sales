"use client";

import { useState } from "react";

export function RollbackVersionButton({
  dataSourceId,
  versionId,
}: {
  dataSourceId: string;
  versionId: string;
}) {
  const [pending, setPending] = useState(false);
  return (
    <button
      disabled={pending}
      className="min-h-10 rounded-lg border px-3 text-sm font-medium hover:bg-slate-50 disabled:opacity-50"
      onClick={async () => {
        if (
          !window.confirm(
            "Restore this workbook version? Affected dashboards will require review.",
          )
        )
          return;
        setPending(true);
        const response = await fetch(
          `/api/data-sources/${dataSourceId}/excel-versions/${versionId}/rollback`,
          { method: "POST" },
        );
        setPending(false);
        if (response.ok) window.location.reload();
      }}
    >
      {pending ? "Restoring…" : "Rollback"}
    </button>
  );
}
