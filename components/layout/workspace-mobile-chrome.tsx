"use client";

import { createContext, useContext, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type MobileChromeSlots = {
  /** The workspace navigation menu, for the start of the page header. */
  start: ReactNode;
  /** The account menu, for the end of the page header. */
  end: ReactNode;
};

const WorkspaceMobileChromeContext = createContext<MobileChromeSlots | null>(
  null,
);

export const WorkspaceMobileChromeProvider =
  WorkspaceMobileChromeContext.Provider;

/**
 * Below `lg` a chat screen replaces the shell's top bar with its own header, so
 * the shell hands its two mobile controls over and the page places them at
 * either end of that row. Renders nothing unless the shell has provided them —
 * on wide screens the shell's own bar is showing, and the slot is hidden.
 */
export function WorkspaceMobileChrome({
  slot,
  className,
}: {
  slot: keyof MobileChromeSlots;
  className?: string;
}) {
  const slots = useContext(WorkspaceMobileChromeContext);
  if (!slots) return null;
  return (
    <div className={cn("flex shrink-0 items-center lg:hidden", className)}>
      {slots[slot]}
    </div>
  );
}
