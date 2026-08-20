"use client";

import { useState, useTransition } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { finalizeDashboardAction } from "@/features/analysis/actions";

export function FinalizeDashboardButton({ jobId }: { jobId: string }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await finalizeDashboardAction(jobId);
            if (result && !result.ok) setMessage(result.error.message);
          })
        }
      >
        {pending ? (
          <LoaderCircle
            className="animate-spin motion-reduce:animate-none"
            size={18}
          />
        ) : (
          <Save size={18} />
        )}
        Save generated dashboard
      </Button>
      {message ? (
        <p className="mt-2 text-sm text-destructive" aria-live="polite">
          {message}
        </p>
      ) : null}
    </div>
  );
}
