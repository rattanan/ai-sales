"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, Pencil, RotateCcw } from "lucide-react";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { Button } from "@/components/ui/button";
import type { WorkspaceLocale } from "@/lib/workspace-i18n";

export function formatChatRelativeTime(
  dateString: string,
  now: number,
  locale: WorkspaceLocale,
) {
  const timestamp = new Date(dateString).getTime();
  if (!Number.isFinite(timestamp)) return "";

  const elapsedSeconds = Math.max(0, Math.floor((now - timestamp) / 1_000));
  if (elapsedSeconds < 60) return locale === "th" ? "เมื่อสักครู่" : "Just now";

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60)
    return locale === "th"
      ? `${elapsedMinutes} นาทีที่แล้ว`
      : new Intl.RelativeTimeFormat(locale).format(-elapsedMinutes, "minute");

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24)
    return locale === "th"
      ? `${elapsedHours} ชั่วโมงที่แล้ว`
      : new Intl.RelativeTimeFormat(locale).format(-elapsedHours, "hour");

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 30)
    return locale === "th"
      ? `${elapsedDays} วันที่แล้ว`
      : new Intl.RelativeTimeFormat(locale).format(-elapsedDays, "day");

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedDays < 365)
    return locale === "th"
      ? `${elapsedMonths} เดือนที่แล้ว`
      : new Intl.RelativeTimeFormat(locale).format(-elapsedMonths, "month");

  const elapsedYears = Math.floor(elapsedDays / 365);
  return locale === "th"
    ? `${elapsedYears} ปีที่แล้ว`
    : new Intl.RelativeTimeFormat(locale).format(-elapsedYears, "year");
}

export function formatChatFullDateTime(
  dateString: string,
  locale: WorkspaceLocale,
) {
  const date = new Date(dateString);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    // Non-secure or embedded contexts may not expose the Clipboard API.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Unable to copy message");
}

const actionClassName =
  "inline-flex size-11 cursor-pointer items-center justify-center rounded-md transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-40 motion-reduce:transition-none [@media(hover:hover)]:size-8";

export function ChatMessageActions({
  content,
  createdAt,
  now,
  align = "start",
  disabled = false,
  onRetry,
  onEdit,
  allowCopy = true,
}: {
  content: string;
  createdAt?: string;
  now: number;
  align?: "start" | "end";
  disabled?: boolean;
  onRetry?: () => void;
  onEdit?: () => void;
  allowCopy?: boolean;
}) {
  const { locale, t } = useWorkspaceLocale();
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    },
    [],
  );

  async function handleCopy() {
    try {
      await copyText(content);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
    if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
    resetTimerRef.current = setTimeout(() => setCopyStatus("idle"), 1_800);
  }

  const copyLabel =
    copyStatus === "copied"
      ? t("Message copied")
      : copyStatus === "error"
        ? t("Could not copy message")
        : t("Copy message");

  return (
    <div
      className={`mt-1 flex min-h-11 items-center gap-1 text-xs text-muted-foreground ${align === "end" ? "justify-end" : "justify-start"}`}
    >
      {createdAt ? (
        <time
          dateTime={createdAt}
          title={formatChatFullDateTime(createdAt, locale)}
          className="tabular-nums"
          suppressHydrationWarning
        >
          {formatChatRelativeTime(createdAt, now, locale)}
        </time>
      ) : null}
      {onRetry || onEdit || allowCopy ? (
        /* Held at zero width until revealed, so the timestamp sits flush against
           the bubble's edge and slides aside as the controls open. The animation
           is on grid-template-columns because that resolves to the buttons' own
           width — a max-width guess would clip the day another one is added. */
        <div className="grid grid-cols-[1fr] transition-[grid-template-columns] duration-200 ease-out motion-reduce:transition-none [@media(hover:hover)]:grid-cols-[0fr] [@media(hover:hover)]:group-focus-within/message:grid-cols-[1fr] [@media(hover:hover)]:group-hover/message:grid-cols-[1fr]">
          <div className="flex items-center gap-2 overflow-hidden opacity-100 transition-opacity duration-200 motion-reduce:transition-none [@media(hover:hover)]:gap-0.5 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within/message:opacity-100 [@media(hover:hover)]:group-hover/message:opacity-100">
            {onRetry ? (
              <button
                type="button"
                title={t("Retry message")}
                aria-label={t("Retry message")}
                disabled={disabled}
                onClick={onRetry}
                className={actionClassName}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            {onEdit ? (
              <button
                type="button"
                title={t("Edit message")}
                aria-label={t("Edit message")}
                disabled={disabled}
                onClick={onEdit}
                className={actionClassName}
              >
                <Pencil className="size-4" aria-hidden="true" />
              </button>
            ) : null}
            {allowCopy ? (
              <button
                type="button"
                title={copyLabel}
                aria-label={copyLabel}
                onClick={() => void handleCopy()}
                className={actionClassName}
              >
                {copyStatus === "copied" ? (
                  <Check
                    className="size-4 text-emerald-600"
                    aria-hidden="true"
                  />
                ) : (
                  <Copy className="size-4" aria-hidden="true" />
                )}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {copyStatus !== "idle" ? (
        <span className="sr-only" role="status" aria-live="polite">
          {copyLabel}
        </span>
      ) : null}
    </div>
  );
}

export function ChatMessageEditor({
  content,
  disabled = false,
  onCancel,
  onSubmit,
}: {
  content: string;
  disabled?: boolean;
  onCancel: () => void;
  onSubmit: (content: string) => void;
}) {
  const { t } = useWorkspaceLocale();
  const [value, setValue] = useState(content);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }, []);

  function submit() {
    const nextContent = value.trim();
    if (!nextContent || disabled) return;
    onSubmit(nextContent);
  }

  return (
    <div className="ml-auto w-full max-w-[32rem] rounded-2xl border border-primary/30 bg-card p-2 shadow-sm">
      <textarea
        ref={textareaRef}
        value={value}
        aria-label={t("Edit message")}
        rows={3}
        disabled={disabled}
        onChange={(event) => {
          setValue(event.target.value);
          event.target.style.height = "auto";
          event.target.style.height = `${event.target.scrollHeight}px`;
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
            return;
          }
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            submit();
          }
        }}
        className="max-h-60 min-h-24 w-full resize-none overflow-y-auto rounded-xl border-0 bg-muted/50 px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:bg-muted/70 focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
      />
      <div className="mt-2 flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={disabled || !value.trim()}
          onClick={submit}
        >
          {t("Send")}
        </Button>
      </div>
    </div>
  );
}
