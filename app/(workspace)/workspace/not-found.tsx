import Link from "next/link";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="grid min-h-96 place-items-center rounded-xl border bg-card p-8 text-center">
      <div>
        <SearchX className="mx-auto text-slate-400" size={34} />
        <h1 className="mt-4 text-xl font-semibold">Resource not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          It may not exist or may belong to another workspace.
        </p>
        <Button asChild className="mt-5">
          <Link href="/workspace">Return to workspace</Link>
        </Button>
      </div>
    </div>
  );
}
