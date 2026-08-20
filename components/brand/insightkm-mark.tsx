import { BrainCircuit } from "lucide-react";
import { cn } from "@/lib/utils";

export function InsightKmMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-primary text-primary-foreground shadow-[0_8px_22px_rgba(79,70,229,0.24)]",
        className,
      )}
      aria-hidden="true"
    >
      <span className="absolute -right-3 -top-3 size-7 rounded-full bg-white/20" />
      <BrainCircuit className="relative" size={20} strokeWidth={1.8} />
    </span>
  );
}

export function InsightKmWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="min-w-0 leading-none">
      <span className="block text-[15px] font-bold tracking-[-0.02em] text-foreground">
        Insight<span className="text-primary">KM</span>
      </span>
      {!compact ? (
        <span className="mt-1 block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          Enterprise Knowledge AI
        </span>
      ) : null}
    </span>
  );
}
