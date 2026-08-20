"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUp,
  Bot,
  Braces,
  Database,
  FileText,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { readChatStream } from "@/lib/chat-stream";
import {
  deleteConversationAction,
  renameConversationAction,
  submitMessageFeedbackAction,
} from "@/features/chat/actions";

type Citation = {
  id: string;
  rank: number;
  score: number;
  quote: string;
  metadata: Record<string, unknown> | null;
};

type ChatMessage = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  errorCode?: string | null;
  citations: Citation[];
  rating?: number | null;
};

type ChatTurnResult = {
  conversation: { id: string };
  userMessage: { id: string; content: string };
  assistantMessage: ChatMessage;
};

export function KnowledgeChat({
  bot,
  conversations,
  selectedConversationId,
  initialMessages,
  projects,
  historyQuery,
  historyPage,
  historyPages,
}: {
  bot: {
    id: string;
    name: string;
    welcomeMessage: string;
    suggestedQuestions: string[];
  };
  conversations: Array<{ id: string; title: string; lastMessageAt: string }>;
  selectedConversationId?: string;
  initialMessages: ChatMessage[];
  projects: Array<{ id: string; name: string }>;
  historyQuery: string;
  historyPage: number;
  historyPages: number;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [conversationId, setConversationId] = useState(selectedConversationId);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [search, setSearch] = useState(historyQuery);
  const [projectId, setProjectId] = useState("");
  const optimisticSequence = useRef(0);
  const visibleConversations = useMemo(
    () =>
      conversations.filter(({ title }) =>
        title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      ),
    [conversations, search],
  );

  async function send(text = input) {
    const message = text.trim();
    if (!message || pending) return;
    setPending(true);
    setError(undefined);
    setInput("");
    optimisticSequence.current += 1;
    const optimisticId = `pending-${optimisticSequence.current}`;
    const streamingId = `streaming-${optimisticSequence.current}`;
    setMessages((current) => [
      ...current,
      { id: optimisticId, role: "USER", content: message, citations: [] },
      { id: streamingId, role: "ASSISTANT", content: "", citations: [] },
    ]);
    try {
      const response = await fetch("/api/knowledge-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          botId: bot.id,
          conversationId,
          projectId: conversationId ? undefined : projectId || undefined,
          message,
        }),
      });
      const payload = await readChatStream<ChatTurnResult>(response, {
        onToken(token) {
          setStreaming(true);
          setMessages((current) =>
            current.map((item) =>
              item.id === streamingId
                ? { ...item, content: item.content + token }
                : item,
            ),
          );
        },
      });
      setConversationId(payload.conversation.id);
      setMessages((current) => [
        ...current.filter(
          ({ id }) => id !== optimisticId && id !== streamingId,
        ),
        { ...payload.userMessage, role: "USER", citations: [] },
        payload.assistantMessage,
      ]);
      if (!conversationId) {
        router.replace(
          `/workspace/chat/${bot.id}?conversation=${payload.conversation.id}`,
        );
        router.refresh();
      }
    } catch (caught) {
      setMessages((current) =>
        current.filter(({ id }) => id !== optimisticId && id !== streamingId),
      );
      setError(
        caught instanceof Error
          ? caught.message
          : "The message could not be sent.",
      );
    } finally {
      setPending(false);
      setStreaming(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100dvh-9rem)] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[290px_1fr]">
      <aside className="border-b bg-slate-50/80 p-4 lg:border-b-0 lg:border-r">
        <Button asChild variant="outline" className="w-full">
          <Link href={`/workspace/chat/${bot.id}`}>
            <Plus size={16} /> New conversation
          </Link>
        </Button>
        <form method="get" className="relative mt-4 flex gap-1">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search conversations</span>
            <Search
              className="absolute left-3 top-3.5 text-slate-400"
              size={16}
            />
            <input
              name="q"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search history"
              className="min-h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm"
            />
          </label>
          <button className="min-h-11 rounded-lg border bg-white px-3 text-xs font-medium">
            Find
          </button>
        </form>
        <nav
          aria-label="Conversation history"
          className="mt-4 max-h-64 space-y-2 overflow-y-auto lg:max-h-[calc(100dvh-17rem)]"
        >
          {visibleConversations.map((conversation) => (
            <div
              key={conversation.id}
              className={`rounded-lg border p-2 ${conversation.id === conversationId ? "border-indigo-300 bg-indigo-50" : "bg-white"}`}
            >
              <Link
                href={`/workspace/chat/${bot.id}?conversation=${conversation.id}`}
                className="block min-h-10 truncate rounded px-2 py-2 text-sm font-medium focus-visible:ring-2"
              >
                {conversation.title}
              </Link>
              <details>
                <summary className="cursor-pointer px-2 text-xs text-muted-foreground">
                  Manage
                </summary>
                <div className="mt-2 space-y-2">
                  <form
                    action={renameConversationAction}
                    className="flex gap-1"
                  >
                    <input
                      type="hidden"
                      name="conversationId"
                      value={conversation.id}
                    />
                    <input
                      name="title"
                      defaultValue={conversation.title}
                      aria-label="Conversation title"
                      className="min-h-9 min-w-0 flex-1 rounded border px-2 text-xs"
                    />
                    <button className="rounded border px-2 text-xs">
                      Save
                    </button>
                  </form>
                  <form action={deleteConversationAction}>
                    <input
                      type="hidden"
                      name="conversationId"
                      value={conversation.id}
                    />
                    <button className="flex min-h-9 items-center gap-1 rounded px-2 text-xs text-red-700">
                      <Trash2 size={13} /> Delete
                    </button>
                  </form>
                </div>
              </details>
            </div>
          ))}
        </nav>
        <div className="mt-3 flex items-center justify-between gap-2 text-xs text-muted-foreground">
          {historyPage > 1 ? (
            <Link
              href={`/workspace/chat/${bot.id}?q=${encodeURIComponent(historyQuery)}&page=${historyPage - 1}`}
              className="min-h-11 rounded-lg border bg-white px-3 py-3 font-medium"
            >
              Previous
            </Link>
          ) : (
            <span />
          )}
          <span>
            {historyPage} / {historyPages}
          </span>
          {historyPage < historyPages ? (
            <Link
              href={`/workspace/chat/${bot.id}?q=${encodeURIComponent(historyQuery)}&page=${historyPage + 1}`}
              className="min-h-11 rounded-lg border bg-white px-3 py-3 font-medium"
            >
              Next
            </Link>
          ) : (
            <span />
          )}
        </div>
      </aside>
      <section className="flex min-h-[680px] flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b px-5 py-4">
          <span className="grid size-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
            <Bot size={20} />
          </span>
          <div>
            <h1 className="font-semibold">{bot.name}</h1>
            <p className="text-xs text-muted-foreground">
              Grounded answers with governed citations
            </p>
          </div>
          {!conversationId && projects.length > 1 ? (
            <label className="ml-auto text-xs text-muted-foreground">
              <span className="mb-1 block">Project context</span>
              <select
                value={projectId}
                onChange={(event) => setProjectId(event.target.value)}
                className="min-h-11 rounded-lg border bg-background px-3 text-sm text-foreground"
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </header>
        <ol
          aria-live="polite"
          className="flex-1 space-y-5 overflow-y-auto p-5 sm:p-7"
        >
          {!messages.length ? (
            <li className="mx-auto max-w-2xl rounded-2xl border border-indigo-100 bg-indigo-50/70 p-6 text-center">
              <Bot className="mx-auto text-indigo-700" />
              <p className="mt-3 text-sm leading-6">{bot.welcomeMessage}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {bot.suggestedQuestions.map((question) => (
                  <button
                    key={question}
                    onClick={() => void send(question)}
                    className="min-h-10 rounded-full border bg-white px-3 text-sm hover:border-indigo-300"
                  >
                    {question}
                  </button>
                ))}
              </div>
            </li>
          ) : null}
          {messages.map((message) => (
            <li
              key={message.id}
              className={
                message.role === "USER"
                  ? "ml-auto max-w-2xl"
                  : "mr-auto max-w-3xl"
              }
            >
              <article
                className={
                  message.role === "USER"
                    ? "rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm leading-6 text-white"
                    : "rounded-2xl rounded-bl-sm border bg-white px-5 py-4 text-sm leading-7 shadow-sm"
                }
              >
                <p className="whitespace-pre-wrap">
                  {message.content}
                  {message.id.startsWith("streaming-") ? (
                    <span
                      className="ml-0.5 inline-block animate-pulse text-indigo-600 motion-reduce:animate-none"
                      aria-hidden="true"
                    >
                      ▍
                    </span>
                  ) : null}
                </p>
                {message.citations.length ? (
                  <div className="mt-4 space-y-2 border-t pt-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Sources
                    </p>
                    {message.citations.map((citation) => {
                      const documentId =
                        typeof citation.metadata?.documentId === "string"
                          ? citation.metadata.documentId
                          : "";
                      const page =
                        typeof citation.metadata?.page === "number"
                          ? citation.metadata.page
                          : undefined;
                      const name =
                        typeof citation.metadata?.documentName === "string"
                          ? citation.metadata.documentName
                          : "Source document";
                      const webUrl =
                        typeof citation.metadata?.canonicalUrl === "string"
                          ? citation.metadata.canonicalUrl
                          : typeof citation.metadata?.url === "string"
                            ? citation.metadata.url
                            : "";
                      const fetchedAt =
                        typeof citation.metadata?.fetchedAt === "string"
                          ? citation.metadata.fetchedAt
                          : "";
                      const databaseSource =
                        citation.metadata?.sourceType === "DATABASE";
                      const legacyApiSource =
                        citation.metadata?.sourceType === "LEGACY_API";
                      const connectionName =
                        typeof citation.metadata?.connectionName === "string"
                          ? citation.metadata.connectionName
                          : "Database";
                      const engine =
                        typeof citation.metadata?.engine === "string"
                          ? citation.metadata.engine
                          : "";
                      const tables = Array.isArray(citation.metadata?.tables)
                        ? citation.metadata.tables.filter(
                            (item): item is string => typeof item === "string",
                          )
                        : [];
                      const executedAt =
                        typeof citation.metadata?.executedAt === "string"
                          ? citation.metadata.executedAt
                          : "";
                      const apiName =
                        typeof citation.metadata?.apiName === "string"
                          ? citation.metadata.apiName
                          : "Registered API";
                      const operation =
                        typeof citation.metadata?.operation === "string"
                          ? citation.metadata.operation
                          : "";
                      const calledAt =
                        typeof citation.metadata?.calledAt === "string"
                          ? citation.metadata.calledAt
                          : "";
                      const durationMs =
                        typeof citation.metadata?.durationMs === "number"
                          ? citation.metadata.durationMs
                          : undefined;
                      const httpStatus =
                        typeof citation.metadata?.httpStatus === "number"
                          ? citation.metadata.httpStatus
                          : undefined;
                      return (
                        <details
                          key={citation.id}
                          className="rounded-lg bg-slate-50 p-2"
                        >
                          <summary className="cursor-pointer text-xs font-medium text-indigo-800">
                            [{citation.rank}]{" "}
                            {databaseSource
                              ? connectionName
                              : legacyApiSource
                                ? apiName
                                : name}
                            {page ? ` · page ${page}` : ""}
                          </summary>
                          <p className="mt-2 text-xs leading-5 text-slate-600">
                            {citation.quote}
                          </p>
                          {fetchedAt ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Fetched {new Date(fetchedAt).toLocaleString()}
                            </p>
                          ) : null}
                          {databaseSource ? (
                            <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                              <Database size={13} className="mt-0.5 shrink-0" />
                              <span>
                                {engine ? `${engine} · ` : ""}
                                {tables.join(", ")}
                                {executedAt
                                  ? ` · ${new Date(executedAt).toLocaleString()}`
                                  : ""}
                              </span>
                            </div>
                          ) : null}
                          {legacyApiSource ? (
                            <div className="mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                              <Braces size={13} className="mt-0.5 shrink-0" />
                              <span>
                                {operation}
                                {httpStatus ? ` · HTTP ${httpStatus}` : ""}
                                {durationMs !== undefined
                                  ? ` · ${durationMs} ms`
                                  : ""}
                                {calledAt
                                  ? ` · ${new Date(calledAt).toLocaleString()}`
                                  : ""}
                              </span>
                            </div>
                          ) : null}
                          {webUrl ? (
                            <a
                              href={webUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline"
                            >
                              <FileText size={13} /> Open web source
                            </a>
                          ) : documentId ? (
                            <a
                              href={`/api/documents/${documentId}/download${page ? `#page=${page}` : ""}`}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-indigo-700 underline"
                            >
                              <FileText size={13} /> Open source
                            </a>
                          ) : null}
                        </details>
                      );
                    })}
                  </div>
                ) : null}
              </article>
              {message.role === "ASSISTANT" &&
              !message.id.startsWith("streaming-") ? (
                <div className="mt-2 flex flex-wrap items-start gap-1">
                  <MessageFeedbackButtons
                    messageId={message.id}
                    initialRating={message.rating}
                  />
                  <details className="rounded-lg border bg-white px-3 py-2 text-xs">
                    <summary className="min-h-7 cursor-pointer py-1 font-medium text-muted-foreground">
                      Feedback details
                    </summary>
                    <form
                      action={async (formData) => {
                        await submitMessageFeedbackAction(formData);
                      }}
                      className="mt-3 grid gap-3 sm:grid-cols-2"
                    >
                      <input
                        type="hidden"
                        name="messageId"
                        value={message.id}
                      />
                      <label>
                        <span className="mb-1 block">Rating</span>
                        <select
                          name="rating"
                          defaultValue={message.rating ?? 1}
                          className="min-h-11 w-full rounded-lg border px-3"
                        >
                          <option value="1">Helpful</option>
                          <option value="-1">Not helpful</option>
                        </select>
                      </label>
                      <label>
                        <span className="mb-1 block">Reason</span>
                        <select
                          name="reason"
                          className="min-h-11 w-full rounded-lg border px-3"
                        >
                          <option value="CORRECT">Correct</option>
                          <option value="CLEAR">Clear</option>
                          <option value="MISSING_INFORMATION">
                            Missing information
                          </option>
                          <option value="INCORRECT">Incorrect</option>
                          <option value="OUTDATED">Outdated</option>
                          <option value="OTHER">Other</option>
                        </select>
                      </label>
                      <label className="sm:col-span-2">
                        <span className="mb-1 block">Optional comment</span>
                        <textarea
                          name="comment"
                          rows={3}
                          maxLength={1000}
                          className="w-full rounded-lg border p-3"
                        />
                      </label>
                      <button className="min-h-11 rounded-lg bg-primary px-4 font-medium text-primary-foreground sm:col-span-2">
                        Save feedback
                      </button>
                    </form>
                  </details>
                </div>
              ) : null}
            </li>
          ))}
          {pending ? (
            <li
              className="mr-auto rounded-2xl border bg-white px-5 py-3 text-sm text-muted-foreground"
              role="status"
            >
              {streaming
                ? "Assistant is responding…"
                : "Searching governed knowledge and preparing an answer…"}
            </li>
          ) : null}
        </ol>
        <div className="border-t bg-white p-4 sm:p-5">
          <p aria-live="assertive" className="mb-2 text-sm text-destructive">
            {error}
          </p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
            className="mx-auto flex max-w-4xl items-end gap-2"
          >
            <label className="flex-1">
              <span className="sr-only">Message {bot.name}</span>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                placeholder="Ask from your permitted knowledge…"
                className="max-h-40 min-h-12 w-full resize-y rounded-xl border bg-slate-50 px-4 py-3 text-sm focus-visible:ring-2 focus-visible:ring-indigo-500"
              />
            </label>
            <Button
              type="submit"
              disabled={pending || !input.trim()}
              aria-label="Send message"
            >
              <ArrowUp size={18} />
            </Button>
          </form>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Answers are grounded in indexed sources. Verify important decisions
            against the citation.
          </p>
        </div>
      </section>
    </div>
  );
}
