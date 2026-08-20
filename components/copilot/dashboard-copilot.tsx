"use client";

import { useEffect, useRef, useState } from "react";
import {
  Bot,
  Code2,
  Copy,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Moon,
  Send,
  Sparkles,
  Square,
  Sun,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql?: string;
  suggestions?: string[];
};

type CopilotEvent = {
  id: string;
  answer: string;
  generatedSql?: string;
  suggestions: string[];
  filters?: Array<{ value: string; datePreset?: string }>;
};

export function DashboardCopilot({
  dashboardId,
  dashboardName,
  widgets,
  canEdit,
}: {
  dashboardId: string;
  dashboardName: string;
  widgets: Array<{ id: string; title: string }>;
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [wide, setWide] = useState(false);
  const [dark, setDark] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [selectedWidgetId, setSelectedWidgetId] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || messages.length) return;
    void fetch(`/api/copilot?dashboardId=${dashboardId}`)
      .then((response) => response.json())
      .then((result) => {
        if (!result.ok) return;
        setMessages(
          result.data.flatMap(
            (item: {
              id: string;
              question: string;
              answer: string;
              generatedSql?: string;
            }) => [
              {
                id: `${item.id}-question`,
                role: "user" as const,
                content: item.question,
              },
              {
                id: item.id,
                role: "assistant" as const,
                content: item.answer,
                sql: item.generatedSql,
              },
            ],
          ),
        );
      })
      .catch(() => undefined);
  }, [dashboardId, messages.length, open]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "k"
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  async function submit(nextPrompt = prompt) {
    const value = nextPrompt.trim();
    if (!value || pending) return;
    setPrompt("");
    setMessages((items) => [
      ...items,
      { id: crypto.randomUUID(), role: "user", content: value },
    ]);
    setPending(true);
    const controller = new AbortController();
    controllerRef.current = controller;
    const responseId = crypto.randomUUID();
    try {
      const response = await fetch("/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          dashboardId,
          prompt: value,
          selectedWidgetId: selectedWidgetId || undefined,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body)
        throw new Error("Copilot request failed");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let metadata: CopilotEvent | null = null;
      let content = "";
      setMessages((items) => [
        ...items,
        { id: responseId, role: "assistant", content: "" },
      ]);
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        buffer += decoder.decode(chunk, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const data = event
            .split("\n")
            .find((line) => line.startsWith("data:"))
            ?.slice(5)
            .trim();
          if (!data) continue;
          if (event.startsWith("event: meta"))
            metadata = JSON.parse(data) as CopilotEvent;
          if (event.startsWith("event: token")) {
            content += JSON.parse(data) as string;
            setMessages((items) =>
              items.map((item) =>
                item.id === responseId ? { ...item, content } : item,
              ),
            );
          }
        }
      }
      if (metadata) {
        setMessages((items) =>
          items.map((item) =>
            item.id === responseId
              ? {
                  ...item,
                  sql: metadata.generatedSql,
                  suggestions: metadata.suggestions,
                }
              : item,
          ),
        );
        if (metadata.filters?.length)
          window.dispatchEvent(
            new CustomEvent("dashboard:copilot-filters", {
              detail: metadata.filters,
            }),
          );
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError")
        setMessages((items) => [
          ...items,
          {
            id: crypto.randomUUID(),
            role: "assistant",
            content: "I couldn’t complete that request. Please retry.",
          },
        ]);
    } finally {
      controllerRef.current = null;
      setPending(false);
    }
  }

  const panelClass = dark
    ? "border-slate-700 bg-slate-950 text-slate-100"
    : "border-slate-200 bg-white text-slate-950";
  return (
    <>
      {!open ? (
        <Button
          type="button"
          className="fixed bottom-5 right-5 z-40 h-12 rounded-full px-4 shadow-xl"
          onClick={() => setOpen(true)}
          aria-label="Open AI Copilot"
        >
          <Sparkles size={18} /> Ask Copilot
        </Button>
      ) : null}
      {open ? (
        <aside
          aria-label="AI Copilot"
          className={`fixed bottom-4 right-4 z-50 flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden rounded-2xl border shadow-2xl ${panelClass} ${wide ? "w-[min(42rem,calc(100vw-2rem))]" : "w-[min(26rem,calc(100vw-2rem))]"}`}
        >
          <header className="flex min-h-14 items-center gap-2 border-b border-inherit px-3">
            <span className="grid size-8 place-items-center rounded-lg bg-primary text-white">
              <Bot size={17} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">AI Copilot</h2>
              <p className="truncate text-xs opacity-65">
                {dashboardName} · ⌘⇧K
              </p>
            </div>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Toggle panel theme"
              onClick={() => setDark((value) => !value)}
            >
              {dark ? <Sun size={16} /> : <Moon size={16} />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Resize panel"
              onClick={() => setWide((value) => !value)}
            >
              {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label="Close AI Copilot"
              onClick={() => setOpen(false)}
            >
              <X size={17} />
            </Button>
          </header>
          <div className="border-b border-inherit px-3 py-2">
            <label className="sr-only" htmlFor="copilot-widget">
              Selected chart
            </label>
            <select
              id="copilot-widget"
              value={selectedWidgetId}
              onChange={(event) => setSelectedWidgetId(event.target.value)}
              className={`min-h-10 w-full rounded-lg border px-3 text-sm ${dark ? "border-slate-700 bg-slate-900" : "bg-white"}`}
            >
              <option value="">Dashboard context (no chart selected)</option>
              {widgets.map((widget) => (
                <option key={widget.id} value={widget.id}>
                  {widget.title}
                </option>
              ))}
            </select>
          </div>
          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3"
            aria-live="polite"
          >
            {!messages.length ? (
              <Welcome canEdit={canEdit} onPrompt={submit} />
            ) : null}
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                dark={dark}
                onPrompt={submit}
              />
            ))}
            {pending ? (
              <div className="flex items-center gap-2 text-xs opacity-70">
                <LoaderCircle className="animate-spin" size={15} /> Thinking
                with dashboard context…
              </div>
            ) : null}
            <div ref={endRef} />
          </div>
          <form
            className="border-t border-inherit p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <label className="sr-only" htmlFor="copilot-prompt">
              Ask AI Copilot
            </label>
            <textarea
              id="copilot-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="Ask about this dashboard…"
              rows={2}
              className={`w-full resize-none rounded-xl border p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${dark ? "border-slate-700 bg-slate-900" : "bg-white"}`}
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="text-xs opacity-60">Validated data only</span>
              {pending ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => controllerRef.current?.abort()}
                >
                  <Square size={14} /> Stop
                </Button>
              ) : (
                <Button type="submit" size="sm" disabled={!prompt.trim()}>
                  <Send size={15} /> Send
                </Button>
              )}
            </div>
          </form>
        </aside>
      ) : null}
    </>
  );
}

function Welcome({
  canEdit,
  onPrompt,
}: {
  canEdit: boolean;
  onPrompt: (prompt: string) => void;
}) {
  const prompts = [
    "Explain this KPI",
    "Compare this month with last month",
    ...(canEdit ? ["Change this to a bar chart"] : []),
  ];
  return (
    <div className="rounded-xl border border-dashed p-4 text-sm">
      <p className="font-medium">Ask in plain language</p>
      <p className="mt-1 text-xs opacity-70">
        I know the dashboard, validated queries, filters, and your permissions.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPrompt(prompt)}
            className="min-h-9 rounded-lg border px-2 text-xs hover:bg-muted"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({
  message,
  dark,
  onPrompt,
}: {
  message: Message;
  dark: boolean;
  onPrompt: (prompt: string) => void;
}) {
  const [showSql, setShowSql] = useState(false);
  if (message.role === "user")
    return (
      <div className="ml-8 rounded-xl bg-primary px-3 py-2 text-sm text-white">
        {message.content}
      </div>
    );
  return (
    <div
      className={`mr-5 rounded-xl p-3 text-sm leading-6 ${dark ? "bg-slate-900" : "bg-slate-100"}`}
    >
      <p>{message.content}</p>
      {message.sql ? (
        <div className="mt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSql((value) => !value)}
              className="flex min-h-9 items-center gap-1 text-xs font-medium text-primary"
            >
              <Code2 size={14} /> {showSql ? "Hide SQL" : "View validated SQL"}
            </button>
            <button
              type="button"
              onClick={() =>
                void navigator.clipboard.writeText(message.sql ?? "")
              }
              className="grid size-9 place-items-center rounded-md hover:bg-white/50"
              aria-label="Copy validated SQL"
            >
              <Copy size={14} />
            </button>
          </div>
          {showSql ? (
            <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              <code>{message.sql}</code>
            </pre>
          ) : null}
        </div>
      ) : null}
      {message.suggestions?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {message.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="min-h-8 rounded-md border px-2 text-xs hover:bg-white/50"
              onClick={() => onPrompt(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
