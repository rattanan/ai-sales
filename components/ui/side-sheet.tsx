"use client";

import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Tailwind's `xl` breakpoint: from here the sheet is a static column. */
const DOCKED_QUERY = "(min-width: 80rem)";

/**
 * A panel that is a static column on a wide screen and slides in from the left
 * as a modal sheet below `xl`. One element serves both, so the server renders
 * the same markup for every viewport and nothing inside is duplicated — the
 * desktop column is simply the sheet with its `xl:` classes applied.
 *
 * While open below `xl` it behaves as a dialog: the scrim and the header button
 * close it, Escape closes it unless something inside (a listbox, a native
 * dialog) already claimed the keystroke, Tab loops inside it, and focus goes
 * back to `returnFocusTo` when it closes. The caller marks the rest of the
 * screen `inert` so the sheet is the only thing left to interact with.
 */
export function SideSheet({
  id,
  open,
  onClose,
  label,
  closeLabel,
  returnFocusTo,
  className,
  children,
}: {
  /** Target for the opening button's `aria-controls`. */
  id: string;
  open: boolean;
  onClose: () => void;
  /** Accessible name, and the visible title of the sheet on a small screen. */
  label: string;
  /** Accessible name of the scrim and the close button. */
  closeLabel: string;
  /** Usually the button that opened the sheet. */
  returnFocusTo?: RefObject<HTMLElement | null>;
  /** Restyles the docked column; the sheet look is fixed. */
  className?: string;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      closeRef.current?.focus();
      return;
    }
    // Only a sheet that was open moves focus: the docked column never does.
    if (!wasOpen.current) return;
    wasOpen.current = false;
    returnFocusTo?.current?.focus();
  }, [open, returnFocusTo]);

  useEffect(() => {
    // A tablet rotated past the breakpoint must not keep a modal sheet open
    // over what has just become a static column. jsdom has no matchMedia.
    if (!open || typeof window.matchMedia !== "function") return;
    const docked = window.matchMedia(DOCKED_QUERY);
    function closeWhenDocked(event: MediaQueryListEvent) {
      if (event.matches) onClose();
    }
    docked.addEventListener("change", closeWhenDocked);
    return () => docked.removeEventListener("change", closeWhenDocked);
  }, [open, onClose]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!open || event.defaultPrevented) return;
    const target = event.target instanceof Element ? event.target : null;
    if (event.key === "Escape") {
      // A native dialog inside the sheet owns its own Escape.
      if (target?.closest("dialog[open]")) return;
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab" || !panelRef.current) return;
    const focusable = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    // `contents` keeps the aside a direct child of the caller's grid, so it can
    // take a column of its own once it docks.
    <div className="contents" onKeyDown={handleKeyDown}>
      {open ? (
        <button
          type="button"
          aria-label={closeLabel}
          onClick={onClose}
          className="fixed inset-0 z-40 cursor-default bg-slate-950/30 backdrop-blur-[1px] xl:hidden"
        />
      ) : null}
      <aside
        ref={panelRef}
        id={id}
        aria-label={label}
        role={open ? "dialog" : undefined}
        aria-modal={open || undefined}
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col bg-card shadow-2xl",
          "pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]",
          // visibility is what keeps the closed sheet out of the tab order and
          // away from assistive tech; it flips only once the slide has ended.
          "transition-[translate,visibility] duration-300 ease-out motion-reduce:transition-none",
          open ? "visible translate-x-0" : "invisible -translate-x-full",
          "xl:static xl:z-auto xl:w-auto xl:visible xl:translate-x-0 xl:rounded-xl xl:border xl:pt-0 xl:pb-0 xl:shadow-none",
          className,
        )}
      >
        <div className="flex items-center justify-between gap-2 border-b px-4 py-3 xl:hidden">
          <h2 className="text-sm font-semibold">{label}</h2>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={onClose}
          >
            <X size={18} aria-hidden="true" />
          </Button>
        </div>
        {children}
      </aside>
    </div>
  );
}
