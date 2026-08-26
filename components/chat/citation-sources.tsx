"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type FocusEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  Database,
  ExternalLink,
  FileText,
  Globe2,
  Lightbulb,
  MessageSquareText,
  Paperclip,
} from "lucide-react";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { cn } from "@/lib/utils";

export type ChatCitation = {
  id: string;
  rank: number;
  quote: string;
  metadata: Record<string, unknown> | null;
};

type CitationKind =
  | "api"
  | "attachment"
  | "conversation"
  | "database"
  | "document"
  | "insight"
  | "web";

export type CitationPresentation = {
  href: string | null;
  kind: CitationKind;
  label: string;
  title: string;
  page: number | null;
  section: string | number | null;
  sheet: string | null;
  row: number | null;
  fetchedAt: string | null;
  executedAt: string | null;
  calledAt: string | null;
  engine: string | null;
  tables: string[];
  operation: string | null;
  httpStatus: number | null;
  durationMs: number | null;
};

function stringValue(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const value = metadata[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Citations may only navigate to public HTTP(S) pages or our own download route. */
function safeWebHref(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function sourceDomain(href: string | null) {
  if (!href) return null;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function citationPresentation(
  citation: ChatCitation,
): CitationPresentation {
  const metadata = citation.metadata ?? {};
  const sourceType = stringValue(metadata, "sourceType")?.toUpperCase() ?? "";
  const webHref =
    safeWebHref(stringValue(metadata, "canonicalUrl")) ??
    safeWebHref(stringValue(metadata, "url"));
  const documentId = stringValue(metadata, "documentId");
  const page = numberValue(metadata, "page");
  const isTemporaryAttachment = sourceType === "CHAT_ATTACHMENT";
  const documentHref =
    documentId && !isTemporaryAttachment
      ? `/api/documents/${encodeURIComponent(documentId)}/download${
          page && page > 0 ? `#page=${Math.trunc(page)}` : ""
        }`
      : null;
  const href = webHref ?? documentHref;

  let kind: CitationKind = "document";
  if (sourceType === "DATABASE") kind = "database";
  else if (sourceType === "LEGACY_API" || sourceType === "API_TOOL")
    kind = "api";
  else if (sourceType === "CHAT_ATTACHMENT") kind = "attachment";
  else if (sourceType === "CONVERSATION_HISTORY") kind = "conversation";
  else if (sourceType === "BUSINESS_INSIGHT") kind = "insight";
  else if (webHref) kind = "web";

  const domain = sourceDomain(webHref);
  const documentName = stringValue(metadata, "documentName");
  const connectionName = stringValue(metadata, "connectionName");
  const apiName = stringValue(metadata, "apiName");
  const explicitTitle = stringValue(metadata, "title");
  const title =
    explicitTitle ??
    documentName ??
    connectionName ??
    apiName ??
    domain ??
    `Source ${citation.rank}`;
  const label =
    domain ??
    connectionName ??
    apiName ??
    documentName ??
    explicitTitle ??
    title;
  const rawTables = metadata.tables;

  return {
    href,
    kind,
    label,
    title,
    page,
    section:
      numberValue(metadata, "section") ?? stringValue(metadata, "section"),
    sheet: stringValue(metadata, "sheet"),
    row: numberValue(metadata, "row"),
    fetchedAt: stringValue(metadata, "fetchedAt"),
    executedAt: stringValue(metadata, "executedAt"),
    calledAt: stringValue(metadata, "calledAt"),
    engine: stringValue(metadata, "engine"),
    tables: Array.isArray(rawTables)
      ? rawTables.filter(
          (table): table is string =>
            typeof table === "string" && Boolean(table.trim()),
        )
      : [],
    operation: stringValue(metadata, "operation"),
    httpStatus: numberValue(metadata, "httpStatus"),
    durationMs: numberValue(metadata, "durationMs"),
  };
}

const KIND_ICONS: Record<
  CitationKind,
  ComponentType<{ className?: string }>
> = {
  api: Braces,
  attachment: Paperclip,
  conversation: MessageSquareText,
  database: Database,
  document: FileText,
  insight: Lightbulb,
  web: Globe2,
};

const KIND_LABELS: Record<CitationKind, string> = {
  api: "API",
  attachment: "Attachment",
  conversation: "Conversation",
  database: "Database",
  document: "Document",
  insight: "Business insight",
  web: "Web source",
};

function formatTimestamp(value: string, locale: "en" | "th") {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat(locale === "th" ? "th-TH" : "en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

type CardPosition = { left: number; top: number; ready: boolean };

export function CitationSource({
  citation,
  variant = "compact",
  onPreview,
}: {
  citation: ChatCitation;
  variant?: "compact" | "number";
  onPreview?: (rank: number) => void;
}) {
  const { locale, t } = useWorkspaceLocale();
  const source = citationPresentation(citation);
  const Icon = KIND_ICONS[source.kind];
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const focusLinkOnOpenRef = useRef(false);
  const suppressNextFocusRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<CardPosition>({
    left: 0,
    top: 0,
    ready: false,
  });
  const baseId = useId();
  const cardId = `${baseId}-citation`;

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const showPreview = useCallback(() => {
    cancelClose();
    setOpen(true);
  }, [cancelClose]);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 120);
  }, [cancelClose]);

  const positionCard = useCallback(() => {
    const trigger = triggerRef.current;
    const card = cardRef.current;
    if (!trigger || !card) return;
    const triggerRect = trigger.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const margin = 12;
    const gap = 8;
    const left = Math.min(
      window.innerWidth - cardRect.width - margin,
      Math.max(
        margin,
        triggerRect.left + triggerRect.width / 2 - cardRect.width / 2,
      ),
    );
    const below = triggerRect.bottom + gap;
    const above = triggerRect.top - cardRect.height - gap;
    const top =
      below + cardRect.height <= window.innerHeight - margin || above < margin
        ? Math.min(below, window.innerHeight - cardRect.height - margin)
        : above;
    setPosition({ left, top: Math.max(margin, top), ready: true });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    positionCard();
    if (focusLinkOnOpenRef.current) {
      cardRef.current?.querySelector<HTMLAnchorElement>("a[href]")?.focus();
      focusLinkOnOpenRef.current = false;
    }
  }, [open, positionCard]);

  useEffect(() => {
    if (!open) return;
    function closeOnOutsidePress(event: PointerEvent) {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target)) return;
      if (cardRef.current?.contains(target)) return;
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        if (document.activeElement !== triggerRef.current) {
          suppressNextFocusRef.current = true;
          triggerRef.current?.focus();
        }
      }
    }
    window.addEventListener("resize", positionCard);
    window.addEventListener("scroll", positionCard, true);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("resize", positionCard);
      window.removeEventListener("scroll", positionCard, true);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, positionCard]);

  useEffect(
    () => () => {
      if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    },
    [],
  );

  function closeAfterFocusLeaves(event: FocusEvent<HTMLElement>) {
    const next = event.relatedTarget;
    if (next instanceof Node && cardRef.current?.contains(next)) return;
    if (next instanceof Node && triggerRef.current?.contains(next)) return;
    scheduleClose();
  }

  const details = [
    source.page ? `${t("Page")} ${Math.trunc(source.page)}` : null,
    source.section ? `${t("Section")} ${source.section}` : null,
    source.sheet ? `${t("Sheet")} ${source.sheet}` : null,
    source.row ? `${t("Row")} ${Math.trunc(source.row)}` : null,
    source.engine,
    source.tables.length ? source.tables.join(", ") : null,
    source.operation,
    source.httpStatus ? `HTTP ${Math.trunc(source.httpStatus)}` : null,
    source.durationMs !== null ? `${Math.round(source.durationMs)} ms` : null,
    source.fetchedAt
      ? `${t("Fetched")} ${formatTimestamp(source.fetchedAt, locale)}`
      : null,
    source.executedAt
      ? `${t("Executed")} ${formatTimestamp(source.executedAt, locale)}`
      : null,
    source.calledAt
      ? `${t("Called")} ${formatTimestamp(source.calledAt, locale)}`
      : null,
  ].filter((detail): detail is string => Boolean(detail));

  const preview = open
    ? createPortal(
        <div
          ref={cardRef}
          id={cardId}
          role="dialog"
          aria-label={`${t("Source preview")}: ${source.title}`}
          onPointerEnter={cancelClose}
          onPointerLeave={scheduleClose}
          onFocus={showPreview}
          onBlur={closeAfterFocusLeaves}
          className="fixed z-[100] w-80 max-w-[calc(100vw-1.5rem)] rounded-xl border bg-card p-3 text-left text-foreground shadow-xl transition-[opacity,transform] duration-150 motion-reduce:transition-none"
          style={{
            left: position.left,
            top: position.top,
            opacity: position.ready ? 1 : 0,
            transform: position.ready ? "translateY(0)" : "translateY(2px)",
            visibility: position.ready ? "visible" : "hidden",
          }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
              <Icon className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-xs font-medium text-muted-foreground">
                {source.label}
              </p>
              <p className="text-[11px] text-muted-foreground/80">
                {t(KIND_LABELS[source.kind])}
              </p>
            </div>
          </div>
          <p className="mt-2 line-clamp-2 text-sm font-semibold leading-5">
            {source.title}
          </p>
          <p className="mt-1 line-clamp-3 text-sm leading-5 text-muted-foreground">
            {citation.quote}
          </p>
          {details.length ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {details.map((detail) => (
                <span
                  key={detail}
                  className="max-w-full truncate rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"
                >
                  {detail}
                </span>
              ))}
            </div>
          ) : null}
          {source.href ? (
            <a
              href={source.href}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex min-h-9 items-center gap-1.5 rounded-lg text-xs font-semibold text-foreground decoration-primary decoration-2 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {t("Open source")}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("No link is available for this governed source.")}
            </p>
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? cardId : undefined}
        aria-label={`${t("View source")} ${citation.rank}: ${source.title}`}
        onClick={() => {
          showPreview();
          onPreview?.(citation.rank);
        }}
        onKeyDown={(event) => {
          if (source.href && (event.key === "Enter" || event.key === " "))
            focusLinkOnOpenRef.current = true;
        }}
        onPointerEnter={showPreview}
        onPointerLeave={scheduleClose}
        onFocus={() => {
          if (suppressNextFocusRef.current) {
            suppressNextFocusRef.current = false;
            return;
          }
          showPreview();
        }}
        onBlur={closeAfterFocusLeaves}
        className={cn(
          "inline-flex touch-manipulation cursor-pointer items-center border border-transparent bg-muted text-muted-foreground transition-colors duration-150 hover:bg-border hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 motion-reduce:transition-none",
          open && "border-foreground/10 bg-foreground text-background",
          variant === "number" &&
            "mx-0.5 h-5 min-w-5 justify-center rounded-full px-1 align-baseline text-[11px] leading-none font-medium tabular-nums",
          variant === "compact" && "h-7 gap-1 rounded-full px-1.5 py-0 text-xs",
        )}
      >
        {variant === "number" ? (
          citation.rank
        ) : (
          <>
            <span
              className={cn(
                "grid size-5 shrink-0 place-items-center rounded-full bg-background text-[10px] font-semibold text-foreground tabular-nums",
                open && "bg-background/15 text-background",
              )}
            >
              {citation.rank}
            </span>
            <Icon className="size-3.5 shrink-0" aria-hidden="true" />
          </>
        )}
      </button>
      {preview}
    </>
  );
}

export function CitationSources({ citations }: { citations: ChatCitation[] }) {
  const { t } = useWorkspaceLocale();
  if (!citations.length) return null;
  return (
    <div
      role="list"
      aria-label={t("Sources")}
      className="mt-2 flex flex-wrap items-center gap-1.5"
    >
      {citations.map((citation) => (
        <span key={citation.id} role="listitem" className="inline-flex">
          <CitationSource citation={citation} />
        </span>
      ))}
    </div>
  );
}
