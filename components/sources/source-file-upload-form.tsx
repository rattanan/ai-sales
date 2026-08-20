"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function SourceFileUploadForm({ sourceId }: { sourceId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<
    { tone: "success" | "error"; text: string } | undefined
  >();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setMessage({ tone: "error", text: "Choose a file to upload." });
      return;
    }

    setUploading(true);
    setMessage(undefined);
    const body = new FormData();
    body.set("file", file);
    try {
      const response = await fetch(
        `/api/knowledge-sources/${sourceId}/documents`,
        {
          method: "POST",
          body,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        duplicate?: boolean;
        message?: string;
      } | null;
      if (!response.ok)
        throw new Error(payload?.message ?? "File upload failed.");

      setMessage({
        tone: "success",
        text: payload?.duplicate
          ? "This file is already in the source."
          : "File uploaded. Indexing has been queued.",
      });
      form.reset();
      router.refresh();
    } catch (error) {
      setMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "File upload failed.",
      });
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <label htmlFor="source-file-upload" className="sr-only">
        Choose a document
      </label>
      <Input
        ref={inputRef}
        id="source-file-upload"
        type="file"
        accept=".pdf,.docx,.xlsx,.csv,.txt,.md,.markdown,.html,.htm"
        required
        disabled={uploading}
        aria-describedby="source-file-upload-status"
      />
      <Button type="submit" className="w-full" disabled={uploading}>
        <UploadCloud size={16} aria-hidden="true" />
        {uploading ? "Uploading…" : "Upload file / new version"}
      </Button>
      <p
        id="source-file-upload-status"
        aria-live="polite"
        className={
          message?.tone === "error"
            ? "text-xs text-destructive"
            : "text-xs text-emerald-700"
        }
      >
        {message ? (
          <span className="inline-flex items-center gap-1">
            {message.tone === "success" ? (
              <CheckCircle2 size={14} aria-hidden="true" />
            ) : null}
            {message.text}
          </span>
        ) : (
          "PDF, DOCX, XLSX, CSV, TXT, Markdown, or HTML"
        )}
      </p>
    </form>
  );
}
