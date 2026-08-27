"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type KeyboardEvent,
} from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// Literal class strings, because Tailwind only emits what it can read.
const COMPACT_TEXT = {
  sm: "max-sm:sr-only",
  md: "max-md:sr-only",
} as const;
const COMPACT_PILL = {
  sm: "max-sm:justify-center max-sm:px-2.5",
  md: "max-md:justify-center max-md:px-2.5",
} as const;

export type SelectMenuOption<Value extends string> = {
  value: Value;
  label: string;
  /** Second line in the popup only. The trigger always shows `label` alone. */
  hint?: string;
};

/**
 * A select-only combobox, following the ARIA pattern of that name: focus stays
 * on the trigger and the highlighted row is tracked with
 * `aria-activedescendant`, so the popup never has to manage focus itself.
 *
 * Written here rather than pulled in because a dropdown dependency would only
 * have contributed the popup, and these menus are anchored inside a chat panel
 * that already bounds its own overflow — collision detection and a portal buy
 * nothing. Keyboard behaviour matches a native select closely enough to be
 * unsurprising, typeahead included.
 *
 * A native `<select>` remains the right answer inside a `<form>` that posts the
 * value: there, the element *is* the payload.
 */
export function SelectMenu<Value extends string>({
  value,
  options,
  onChange,
  label,
  caption,
  disabled = false,
  variant = "field",
  side = "bottom",
  align = "start",
  icon: Icon,
  compactBelow,
  className,
}: {
  value: Value;
  options: Array<SelectMenuOption<Value>>;
  onChange: (value: Value) => void;
  /** Accessible name. Also the visible caption unless `caption` is given. */
  label: string;
  /**
   * Muted text before the value, for a trigger that has no label above it. The
   * selected value alone is often not self-describing — "Auto" says nothing
   * without "Mode" in front of it.
   */
  caption?: string;
  disabled?: boolean;
  /** `field` matches a form row; `pill` matches the chat composer toolbar. */
  variant?: "field" | "pill";
  side?: "top" | "bottom";
  align?: "start" | "end";
  icon?: ComponentType<{ size?: number; className?: string }>;
  /**
   * Below this breakpoint a pill shows only its icon and chevron; the caption
   * and value stay in the accessible name and in the trigger's tooltip. Pair
   * it with `icon`, or the pill has nothing left to show.
   */
  compactBelow?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const baseId = useId();
  const listId = `${baseId}-listbox`;
  const optionId = (index: number) => `${baseId}-option-${index}`;

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const selected = options[selectedIndex];

  function openAt(index: number) {
    setActiveIndex(index);
    setOpen(true);
  }

  function commit(index: number) {
    onChange(options[index].value);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    // Optional call: jsdom has no scrollIntoView, and a menu short enough not to
    // scroll does not need it either.
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  useLayoutEffect(() => {
    // A pill at the left edge of a phone with `align="end"` would open off
    // screen; the popup flips to the side that fits before it is painted. The
    // list unmounts on close, so the inline override never needs undoing.
    const list = listRef.current;
    if (!open || !list) return;
    const rect = list.getBoundingClientRect();
    // jsdom lays nothing out: a zero-width box says nothing about overflow.
    if (rect.width === 0) return;
    const viewportWidth = document.documentElement.clientWidth;
    if (rect.left < 8) {
      list.style.left = "0";
      list.style.right = "auto";
    } else if (rect.right > viewportWidth - 8) {
      list.style.right = "0";
      list.style.left = "auto";
    }
  }, [open]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const last = options.length - 1;
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) commit(activeIndex);
      else openAt(selectedIndex);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        openAt(selectedIndex);
        return;
      }
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((index) => Math.min(last, Math.max(0, index + step)));
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const target = event.key === "Home" ? 0 : last;
      if (open) setActiveIndex(target);
      else openAt(target);
      return;
    }
    // Typeahead, as a native select does it: the search starts after the row
    // you are on and wraps, so pressing the same key walks the matches.
    if (
      event.key.length !== 1 ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    const from = (open ? activeIndex : selectedIndex) + 1;
    const typed = event.key.toLowerCase();
    const match = options
      .map((_, index) => (from + index) % options.length)
      .find((index) => options[index].label.toLowerCase().startsWith(typed));
    if (match === undefined) return;
    event.preventDefault();
    if (open) setActiveIndex(match);
    else commit(match);
  }

  return (
    <div
      className={cn(
        "relative",
        variant === "field" && "w-full",
        variant === "pill" && "inline-flex",
        className,
      )}
    >
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={label}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        disabled={disabled}
        title={`${caption ?? label}: ${selected?.label ?? ""}`}
        onClick={() => (open ? setOpen(false) : openAt(selectedIndex))}
        onKeyDown={handleKeyDown}
        className={cn(
          "flex min-h-11 cursor-pointer items-center gap-2 border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-45",
          variant === "field" &&
            "w-full rounded-lg bg-background px-3 text-left hover:border-slate-400",
          variant === "pill" &&
            "rounded-full bg-card px-4 font-semibold hover:bg-muted",
          compactBelow && COMPACT_PILL[compactBelow],
          open && "border-primary",
        )}
      >
        {Icon ? (
          <Icon size={16} className="shrink-0 text-muted-foreground" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            compactBelow && COMPACT_TEXT[compactBelow],
          )}
        >
          {caption ? (
            <span className="font-normal text-muted-foreground">
              {caption}{" "}
            </span>
          ) : null}
          {selected?.label}
        </span>
        <ChevronDown
          size={15}
          aria-hidden="true"
          className={cn(
            "shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>
      {open ? (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={label}
          className={cn(
            "absolute z-50 max-h-72 max-w-[calc(100vw-1rem)] min-w-full overflow-y-auto rounded-xl border bg-card p-1 shadow-lg",
            side === "bottom" ? "top-full mt-1" : "bottom-full mb-1",
            align === "start" ? "left-0" : "right-0",
            variant === "pill" && "w-max",
          )}
        >
          {options.map((option, index) => (
            <li
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={option.value === value}
              data-active={index === activeIndex}
              onPointerEnter={() => setActiveIndex(index)}
              onClick={() => commit(index)}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg px-2.5 py-2 text-sm",
                index === activeIndex && "bg-muted",
              )}
            >
              <Check
                size={15}
                aria-hidden="true"
                className={cn(
                  "mt-0.5 shrink-0 text-primary",
                  option.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                {option.hint ? (
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
