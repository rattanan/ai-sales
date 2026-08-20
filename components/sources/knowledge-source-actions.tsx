"use client";

import Link from "next/link";
import {
  refreshSourceAction,
  reindexSourceAction,
} from "@/features/knowledge/source-actions";
import { archiveKnowledgeSourceAction } from "@/features/knowledge/unified-source-actions";

export function KnowledgeSourceActions({
  id,
  type,
}: {
  id: string;
  type: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {type === "COPIED TEXT" ? (
        <Link
          href={`/workspace/sources/copied-text/${id}/edit`}
          className="min-h-11 rounded-lg border px-3 py-2.5 text-sm font-medium"
        >
          Edit content
        </Link>
      ) : null}
      {type === "WEB URL" || type === "SHARED FOLDER" ? (
        <form action={refreshSourceAction}>
          <input type="hidden" name="id" value={id} />
          <button className="min-h-11 rounded-lg border px-3 text-sm font-medium">
            Refresh / sync
          </button>
        </form>
      ) : null}
      <form action={reindexSourceAction}>
        <input type="hidden" name="id" value={id} />
        <button className="min-h-11 rounded-lg border px-3 text-sm font-medium">
          Re-index
        </button>
      </form>
      <form
        action={archiveKnowledgeSourceAction}
        onSubmit={(event) => {
          if (
            !window.confirm(
              "Disable this source and remove its bot assignments?",
            )
          )
            event.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button className="min-h-11 rounded-lg border border-red-200 px-3 text-sm font-medium text-red-700">
          Delete
        </button>
      </form>
    </div>
  );
}
