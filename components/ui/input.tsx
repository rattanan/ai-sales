import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary focus:outline-none md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-28 w-full resize-y rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-primary focus:outline-none md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-11 w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-xs focus:border-primary focus:outline-none md:text-sm",
        className,
      )}
      {...props}
    />
  );
}
