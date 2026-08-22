"use client";

import { useRef } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  CHAT_ATTACHMENT_ACCEPT,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_MAX_FILES,
  CHAT_ATTACHMENT_MAX_TOTAL_BYTES,
  formatAttachmentSize,
} from "@/lib/chat-attachments";

export function ChatAttachmentPicker({
  files,
  disabled,
  onChange,
  onError,
}: {
  files: File[];
  disabled?: boolean;
  onChange: (files: File[]) => void;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function addFiles(selected: File[]) {
    const next = [...files];
    for (const file of selected) {
      if (
        next.some((item) => item.name === file.name && item.size === file.size)
      )
        continue;
      if (next.length >= CHAT_ATTACHMENT_MAX_FILES) {
        onError(`Attach up to ${CHAT_ATTACHMENT_MAX_FILES} files per message.`);
        return;
      }
      if (file.size < 1 || file.size > CHAT_ATTACHMENT_MAX_BYTES) {
        onError(
          `${file.name} must be smaller than ${formatAttachmentSize(CHAT_ATTACHMENT_MAX_BYTES)}.`,
        );
        return;
      }
      if (
        next.reduce((total, item) => total + item.size, 0) + file.size >
        CHAT_ATTACHMENT_MAX_TOTAL_BYTES
      ) {
        onError(
          `Attachments can total up to ${formatAttachmentSize(CHAT_ATTACHMENT_MAX_TOTAL_BYTES)} per message.`,
        );
        return;
      }
      next.push(file);
    }
    onError("");
    onChange(next);
  }

  return (
    <div className="min-w-0">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={CHAT_ATTACHMENT_ACCEPT}
        disabled={disabled}
        className="sr-only"
        aria-label="Attach documents"
        onChange={(event) => {
          addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        disabled={disabled || files.length >= CHAT_ATTACHMENT_MAX_FILES}
        aria-label="Attach documents"
        title="Attach PDF, Word, Excel, CSV, text, Markdown, or HTML"
        onClick={() => inputRef.current?.click()}
      >
        <Paperclip size={16} aria-hidden="true" />
        <span className="hidden sm:inline">Attach</span>
      </Button>
      {files.length ? (
        <ul
          className="mt-2 flex flex-wrap gap-2"
          aria-label="Files attached to this message"
        >
          {files.map((file) => (
            <li
              key={`${file.name}-${file.size}`}
              className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg border bg-muted/60 px-2.5 py-1.5 text-xs"
            >
              <FileText size={14} className="shrink-0 text-primary" />
              <span className="max-w-48 truncate" title={file.name}>
                {file.name}
              </span>
              <span className="shrink-0 text-muted-foreground">
                {formatAttachmentSize(file.size)}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() =>
                  onChange(
                    files.filter(
                      (item) =>
                        item.name !== file.name || item.size !== file.size,
                    ),
                  )
                }
                className="grid size-6 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Remove ${file.name}`}
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {files.length
          ? `${files.length} file${files.length === 1 ? "" : "s"} attached.`
          : "No files attached."}
      </p>
    </div>
  );
}

export function ChatMessageAttachments({ names }: { names?: string[] }) {
  if (!names?.length) return null;
  return (
    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Attached files">
      {names.map((name) => (
        <li
          key={name}
          className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-current/15 bg-background/10 px-2 py-1 text-xs"
        >
          <FileText size={13} className="shrink-0" aria-hidden="true" />
          <span className="max-w-56 truncate" title={name}>
            {name}
          </span>
        </li>
      ))}
    </ul>
  );
}
