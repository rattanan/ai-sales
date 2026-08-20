"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("Workspace render failed", error.digest);
  }, [error]);
  return (
    <div className="grid min-h-96 place-items-center rounded-xl border bg-card p-8 text-center">
      <div>
        <AlertTriangle className="mx-auto text-destructive" size={34} />
        <h1 className="mt-4 text-xl font-semibold">
          This workspace could not be loaded
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The error was logged without exposing sensitive connection details.
        </p>
        <Button className="mt-5" onClick={() => unstable_retry()}>
          Try again
        </Button>
      </div>
    </div>
  );
}
