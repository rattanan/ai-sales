"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { ArrowUp, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Chat composer primitives, adapted from prompt-kit (MIT — prompt-kit.com).
 *
 * Two substitutions keep the shape without the dependencies it assumes: a bare
 * textarea rather than shadcn's form-field `Textarea`, whose border, ring and
 * hover rules would all have to be unset for a borderless composer, and native
 * `title` tooltips rather than `@radix-ui/react-tooltip`.
 *
 * `value` is controlled here only. Upstream also keeps an internal copy as a
 * fallback, which lets the two drift apart once a parent resets the field.
 */

type PromptInputContextValue = {
  value: string;
  setValue: (value: string) => void;
  submit: () => void;
  loading: boolean;
  disabled: boolean;
  maxHeight: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
};

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

function usePromptInput() {
  const context = useContext(PromptInputContext);
  if (!context)
    throw new Error("PromptInput parts must be rendered inside <PromptInput>.");
  return context;
}

export function PromptInput({
  value,
  onValueChange,
  onSubmit,
  loading = false,
  disabled = false,
  maxHeight = 220,
  className,
  children,
  onClick,
  ...props
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit?: () => void;
  /** A turn is in flight: the send button spins, the field stays typeable. */
  loading?: boolean;
  disabled?: boolean;
  maxHeight?: number;
  children: ReactNode;
} & Omit<ComponentProps<"div">, "onSubmit" | "children">) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  function focusFromEmptySpace(event: MouseEvent<HTMLDivElement>) {
    onClick?.(event);
    if (disabled) return;
    // Only the padding around the controls focuses the field. Focusing on every
    // click would pull focus off a toolbar button the moment it was pressed, so
    // a screen reader never announces the toggle it just changed.
    if (
      event.target instanceof Element &&
      event.target.closest("button, a, input, select, textarea, label")
    )
      return;
    textareaRef.current?.focus();
  }

  return (
    <PromptInputContext.Provider
      value={{
        value,
        setValue: onValueChange,
        submit: () => onSubmit?.(),
        loading,
        disabled,
        maxHeight,
        textareaRef,
      }}
    >
      <div
        onClick={focusFromEmptySpace}
        className={cn(
          // The ring belongs to the whole composer, not the field inside it:
          // one soft outline that follows the rounded shape reads as focus
          // without boxing in the text.
          "cursor-text rounded-3xl border border-input bg-card p-2 shadow-sm transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/30",
          disabled && "cursor-not-allowed opacity-60",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </PromptInputContext.Provider>
  );
}

export function PromptInputTextarea({
  className,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"textarea">, "value" | "onChange" | "disabled">) {
  const { value, setValue, submit, loading, disabled, maxHeight, textareaRef } =
    usePromptInput();

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
  }, [value, maxHeight, textareaRef]);

  return (
    <textarea
      ref={textareaRef}
      value={value}
      disabled={disabled}
      rows={1}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.key !== "Enter" || event.defaultPrevented) return;
        // A Thai or Japanese IME commits its candidate with Enter; sending on
        // that keystroke would cut the word in half.
        if (event.nativeEvent.isComposing) return;
        // Shift or Alt keeps the newline. Plain Enter sends, and so does
        // Ctrl/Cmd + Enter, which is what this composer used to require.
        if (event.shiftKey || event.altKey) return;
        event.preventDefault();
        // Swallowed rather than ignored while a turn is in flight: returning
        // early would leave a stray newline in a field the send button has
        // already disabled.
        if (loading) return;
        submit();
      }}
      className={cn(
        // `prompt-input-field` is what suppresses the app-wide focus outline
        // for this element; see the rule in app/globals.css.
        "prompt-input-field block max-h-[220px] w-full resize-none overflow-y-auto bg-transparent px-3 py-2.5 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  );
}

/** The row under the field: message controls on the left, send on the right. */
export function PromptInputToolbar({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "mt-1 flex flex-wrap items-center justify-between gap-2 px-1 pb-1",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputActions({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-wrap items-center gap-2", className)}
      {...props}
    />
  );
}

/**
 * A pill in the toolbar. `active` is styling only — the caller owns the state
 * semantics, because a toggle needs `aria-pressed` and a disclosure needs
 * `aria-expanded`.
 */
export function PromptInputButton({
  active = false,
  className,
  disabled,
  ...props
}: ComponentProps<typeof Button> & { active?: boolean }) {
  const composer = usePromptInput();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={disabled || composer.disabled}
      className={cn(
        "rounded-full",
        active && "border-primary bg-secondary text-secondary-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function PromptInputSubmit({
  label = "Send message",
  className,
  disabled,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & { label?: string }) {
  const { submit, loading, disabled: composerDisabled } = usePromptInput();
  return (
    <Button
      type="button"
      size="icon"
      aria-label={label}
      title={label}
      disabled={disabled || composerDisabled || loading}
      onClick={submit}
      className={cn("rounded-full", className)}
      {...props}
    >
      {loading ? (
        <LoaderCircle
          className="animate-spin motion-reduce:animate-none"
          size={18}
          aria-hidden="true"
        />
      ) : (
        <ArrowUp size={18} aria-hidden="true" />
      )}
    </Button>
  );
}
