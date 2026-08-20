"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  ChevronRight,
  Database,
  Download,
  FileText,
  LoaderCircle,
  MessageSquarePlus,
  PlugZap,
  Search,
  Send,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { readChatStream } from "@/lib/chat-stream";

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  errorCode?: string | null;
  citations: Array<{
    id: string;
    rank: number;
    quote: string;
    metadata: unknown;
  }>;
  toolActivity?: { type: string; status: string };
  rating?: number | null;
};

type ChatTurnResult = {
  conversation: { id: string };
  userMessage: { id: string; content: string };
  assistantMessage: Message;
};

type Scope =
  | "SMART"
  | "ALL_ACCESSIBLE"
  | "SPECIFIC_BOT"
  | "SPECIFIC_SOURCES"
  | "DOCUMENTS"
  | "DATABASES"
  | "API_TOOLS"
  | "CONVERSATION_HISTORY"
  | "BUSINESS_INSIGHT";
type Mode =
  | "AUTO"
  | "ASK"
  | "SEARCH"
  | "ANALYZE"
  | "SUMMARIZE"
  | "GENERATE_REPORT"
  | "QUERY_LIVE_DATA";

export function UniversalChat({
  bots,
  sources,
  conversations,
  selectedConversationId,
  initialMessages,
  historyQuery,
}: {
  bots: Array<{ id: string; name: string }>;
  sources: Array<{ id: string; name: string; type: string }>;
  conversations: Array<{
    id: string;
    title: string;
    botName: string;
    lastMessageAt: string;
  }>;
  selectedConversationId?: string;
  initialMessages: Message[];
  historyQuery: string;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("SMART");
  const [mode, setMode] = useState<Mode>("AUTO");
  const [botId, setBotId] = useState("");
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [conversationId, setConversationId] = useState(selectedConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const showBot = scope === "SPECIFIC_BOT";
  const showSources = scope === "SPECIFIC_SOURCES";
  const selectedSources = useMemo(() => new Set(sourceIds), [sourceIds]);

  function startNewChat() {
    setScope("SMART");
    setMode("AUTO");
    setBotId("");
    setSourceIds([]);
    setConversationId(undefined);
    setMessages([]);
    setMessage("");
    setPending(false);
    setStreaming(false);
    setError("");
  }

  async function send() {
    const content = message.trim();
    if (!content || pending) return;
    if (showBot && !botId) {
      setError("Select a bot for Specific Bot scope.");
      return;
    }
    if (showSources && !sourceIds.length) {
      setError("Select at least one source.");
      return;
    }
    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      role: "USER",
      content,
      citations: [],
    };
    const streamingId = `streaming-${Date.now()}`;
    setMessages((items) => [
      ...items,
      optimistic,
      { id: streamingId, role: "ASSISTANT", content: "", citations: [] },
    ]);
    setMessage("");
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/universal-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversationId,
          message: content,
          scope,
          mode,
          botId: showBot ? botId : undefined,
          sourceIds: showSources ? sourceIds : [],
        }),
      });
      const payload = await readChatStream<ChatTurnResult>(response, {
        onToken(token) {
          setStreaming(true);
          setMessages((items) =>
            items.map((item) =>
              item.id === streamingId
                ? { ...item, content: item.content + token }
                : item,
            ),
          );
        },
      });
      const { conversation, userMessage, assistantMessage } = payload;
      setConversationId(conversation.id);
      setMessages((items) => [
        ...items.filter(
          (item) => item.id !== optimistic.id && item.id !== streamingId,
        ),
        { ...userMessage, role: "USER", citations: [] },
        assistantMessage,
      ]);
      router.replace(
        `/workspace/chat?conversation=${encodeURIComponent(conversation.id)}`,
        { scroll: false },
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "The message could not be completed.",
      );
      setMessages((items) =>
        items.filter(
          (item) => item.id !== optimistic.id && item.id !== streamingId,
        ),
      );
    } finally {
      setPending(false);
      setStreaming(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100dvh-10rem)] gap-5 xl:grid-cols-[290px_minmax(0,1fr)]">
      <aside className="rounded-xl border bg-card p-4">
        <Link
          href="/workspace/chat"
          onClick={startNewChat}
          className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          <MessageSquarePlus size={17} /> New chat
        </Link>
        <form className="relative mt-4">
          <Search
            className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground"
            size={16}
          />
          <input
            name="q"
            defaultValue={historyQuery}
            aria-label="Search conversations"
            placeholder="Search conversations"
            className="min-h-11 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
          />
        </form>
        <nav
          aria-label="Conversations"
          className="mt-4 max-h-[60dvh] space-y-1 overflow-y-auto"
        >
          {conversations.map((conversation) => (
            <Link
              key={conversation.id}
              href={`/workspace/chat?conversation=${conversation.id}`}
              className={`block rounded-lg px-3 py-3 text-sm ${conversation.id === conversationId ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"}`}
            >
              <span className="block truncate font-medium">
                {conversation.title}
              </span>
              <span className="mt-1 block truncate text-xs text-muted-foreground">
                {conversation.botName} ·{" "}
                {new Date(conversation.lastMessageAt).toLocaleDateString()}
              </span>
            </Link>
          ))}
          {!conversations.length ? (
            <p className="px-3 py-5 text-sm text-muted-foreground">
              No universal conversations yet.
            </p>
          ) : null}
        </nav>
      </aside>
      <section className="flex min-h-[680px] min-w-0 flex-col overflow-hidden rounded-xl border bg-card">
        <header className="border-b p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="text-primary" size={20} />
            <h1 className="font-semibold">Universal Chat</h1>
            <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700">
              ACL enforced
            </span>
            {conversationId ? (
              <a
                href={`/api/universal-chat/export?conversation=${conversationId}`}
                className="ml-auto inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium"
              >
                <Download size={16} /> Export
              </a>
            ) : null}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Scope</span>
              <select
                value={scope}
                onChange={(event) => setScope(event.target.value as Scope)}
                className="min-h-11 w-full rounded-lg border bg-background px-3"
              >
                <option value="SMART">Smart routing</option>
                <option value="ALL_ACCESSIBLE">All accessible</option>
                <option value="SPECIFIC_BOT">Specific bot</option>
                <option value="SPECIFIC_SOURCES">Specific sources</option>
                <option value="DOCUMENTS">Documents</option>
                <option value="DATABASES">Databases</option>
                <option value="API_TOOLS">API tools</option>
                <option value="CONVERSATION_HISTORY">
                  Conversation history
                </option>
                <option value="BUSINESS_INSIGHT">Business insight</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Mode</span>
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value as Mode)}
                className="min-h-11 w-full rounded-lg border bg-background px-3"
              >
                <option value="AUTO">Auto</option>
                <option value="ASK">Ask</option>
                <option value="SEARCH">Search</option>
                <option value="ANALYZE">Analyze</option>
                <option value="SUMMARIZE">Summarize</option>
                <option value="GENERATE_REPORT">Generate report</option>
                <option value="QUERY_LIVE_DATA">Query live data</option>
              </select>
            </label>
            {showBot ? (
              <label className="text-sm md:col-span-2">
                <span className="mb-1 block font-medium">Bot</span>
                <select
                  value={botId}
                  onChange={(event) => setBotId(event.target.value)}
                  className="min-h-11 w-full rounded-lg border bg-background px-3"
                >
                  <option value="">Select bot</option>
                  {bots.map((bot) => (
                    <option key={bot.id} value={bot.id}>
                      {bot.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          {showSources ? (
            <fieldset className="mt-3">
              <legend className="text-sm font-medium">Sources</legend>
              <div className="mt-2 flex max-h-32 flex-wrap gap-2 overflow-y-auto">
                {sources.map((source) => (
                  <label
                    key={source.id}
                    className="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={selectedSources.has(source.id)}
                      onChange={(event) =>
                        setSourceIds((items) =>
                          event.target.checked
                            ? [...items, source.id]
                            : items.filter((id) => id !== source.id),
                        )
                      }
                    />
                    {source.name}
                    <span className="text-xs text-muted-foreground">
                      {source.type}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}
        </header>
        <div
          role="log"
          aria-live="polite"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto bg-slate-50/60 p-4 sm:p-6"
        >
          {!messages.length ? (
            <div className="mx-auto mt-16 max-w-xl text-center">
              <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                <Sparkles />
              </span>
              <h2 className="mt-5 text-xl font-semibold">
                Ask across governed knowledge
              </h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Smart routing selects an accessible bot, governed documents, and
                read-only live tools. Change scope at any turn.
              </p>
              <div className="mt-5 grid gap-2 sm:grid-cols-3">
                {[
                  [FileText, "Find a policy"],
                  [Database, "Query live data"],
                  [PlugZap, "Check an API"],
                ].map(([Icon, label]) => {
                  const ItemIcon = Icon as typeof FileText;
                  return (
                    <button
                      key={label as string}
                      type="button"
                      onClick={() => setMessage(label as string)}
                      className="min-h-11 rounded-lg border bg-white px-3 text-sm"
                    >
                      <ItemIcon className="mr-2 inline" size={16} />
                      {label as string}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}
          {messages.map((item) => (
            <article
              key={item.id}
              className={`max-w-3xl ${item.role === "USER" ? "ml-auto" : "mr-auto"}`}
            >
              <div
                className={`rounded-2xl px-4 py-3 text-sm leading-6 whitespace-pre-wrap ${item.role === "USER" ? "bg-primary text-primary-foreground" : "border bg-white"}`}
              >
                {item.content}
                {item.id.startsWith("streaming-") ? (
                  <span
                    className="ml-0.5 inline-block animate-pulse text-primary motion-reduce:animate-none"
                    aria-hidden="true"
                  >
                    ▍
                  </span>
                ) : null}
              </div>
              {item.toolActivity ? (
                <p className="mt-2 inline-flex rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700">
                  Tool: {item.toolActivity.type.replaceAll("_", " ")} ·{" "}
                  {item.toolActivity.status}
                </p>
              ) : null}
              {item.citations.length ? (
                <details className="mt-2 rounded-lg border bg-white px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {item.citations.length} citation(s)
                  </summary>
                  <ol className="mt-2 space-y-2">
                    {item.citations.map((citation) => (
                      <li key={citation.id} className="rounded bg-muted p-2">
                        <span className="font-medium">[{citation.rank}]</span>{" "}
                        {citation.quote}
                      </li>
                    ))}
                  </ol>
                </details>
              ) : null}
              {item.errorCode ? (
                <p className="mt-1 text-xs text-amber-700">
                  Status: {item.errorCode}
                </p>
              ) : null}
              {item.role === "ASSISTANT" &&
              !item.id.startsWith("pending-") &&
              !item.id.startsWith("streaming-") ? (
                <div className="mt-2">
                  <MessageFeedbackButtons
                    messageId={item.id}
                    initialRating={item.rating}
                  />
                </div>
              ) : null}
            </article>
          ))}
          {pending ? (
            <p
              className="flex items-center gap-2 text-sm text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                className="animate-spin motion-reduce:animate-none"
                size={17}
              />{" "}
              {streaming
                ? "Assistant is responding…"
                : "Resolving scope and grounded context…"}
            </p>
          ) : null}
        </div>
        <div className="border-t p-4">
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
          <div className="flex gap-2">
            <textarea
              aria-label="Message InsightKM"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  void send();
                }
              }}
              placeholder="Ask InsightKM…"
              rows={2}
              className="min-h-12 flex-1 resize-none rounded-xl border bg-background p-3 text-sm"
            />
            <Button
              type="button"
              onClick={() => void send()}
              disabled={pending || !message.trim()}
              aria-label="Send message"
            >
              <Send size={17} />
              <span className="hidden sm:inline">Send</span>
            </Button>
          </div>
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Bot size={13} /> Scope and mode are stored on every turn. Ctrl/Cmd
            + Enter to send. <ChevronRight size={13} />{" "}
          </p>
        </div>
      </section>
    </div>
  );
}
