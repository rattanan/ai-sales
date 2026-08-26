"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AgentTrace,
  type AgentTraceEntry,
} from "@/components/chat/agent-trace";
import { CitationSources } from "@/components/chat/citation-sources";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import {
  applyStepEvent,
  mergeTrace,
  messageTrace,
  type ReasoningRow,
} from "@/lib/agent-trace";
import {
  Brain,
  Database,
  Download,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquarePlus,
  Library,
  PlugZap,
  Search,
  Sparkles,
} from "lucide-react";
import {
  PromptInput,
  PromptInputActions,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ui/prompt-input";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { rememberThinkLevel, type ThinkLevel } from "@/lib/chat-preferences";
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { readChatStream } from "@/lib/chat-stream";
import { NtopActionCard } from "@/components/chat/ntop-action-card";
import {
  ChatAttachmentPicker,
  ChatMessageAttachments,
  ChatSelectedAttachments,
} from "@/components/chat/chat-attachment-picker";
import type { NtopSuggestedAction } from "@/schemas/ntop";
import {
  ChatSourcePanel,
  selectedChatSourceScope,
  type ChatKnowledgeSource,
} from "@/components/chat/chat-source-panel";

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  errorCode?: string | null;
  citations: Array<{
    id: string;
    rank: number;
    quote: string;
    metadata: Record<string, unknown> | null;
  }>;
  toolTimeline?: ToolStep[];
  reasoningTimeline?: ReasoningRow[];
  /** Richer trace kept for this session: the uncapped reasoning text. */
  trace?: AgentTraceEntry[];
  rating?: number | null;
  suggestedAction?: NtopSuggestedAction;
  attachments?: string[];
};

type ToolStep = {
  step: number;
  toolName: string;
  type: string;
  status: string;
  durationMs?: number;
  errorCode?: string | null;
  arguments?: Record<string, unknown> | null;
  summary?: string | null;
};

type ChatTurnResult = {
  conversation: { id: string };
  userMessage: { id: string; content: string; attachments?: string[] };
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

const SCOPE_OPTIONS: Array<SelectMenuOption<Scope>> = [
  { value: "SMART", label: "Smart routing", hint: "Assistant picks the tools" },
  {
    value: "ALL_ACCESSIBLE",
    label: "All accessible",
    hint: "Every source you may read",
  },
  {
    value: "SPECIFIC_BOT",
    label: "Specific bot",
    hint: "One bot's assigned knowledge",
  },
  {
    value: "SPECIFIC_SOURCES",
    label: "Specific sources",
    hint: "Only the files you choose",
  },
  { value: "DOCUMENTS", label: "Documents", hint: "Knowledge base files only" },
  { value: "DATABASES", label: "Databases", hint: "Connected databases only" },
  { value: "API_TOOLS", label: "API tools", hint: "Configured API tools only" },
  {
    value: "CONVERSATION_HISTORY",
    label: "Conversation history",
    hint: "Past conversations only",
  },
  {
    value: "BUSINESS_INSIGHT",
    label: "Business insight",
    hint: "Saved analysis results only",
  },
];

const MODE_OPTIONS: Array<SelectMenuOption<Mode>> = [
  { value: "AUTO", label: "Auto" },
  { value: "ASK", label: "Ask" },
  { value: "SEARCH", label: "Search" },
  { value: "ANALYZE", label: "Analyze" },
  { value: "SUMMARIZE", label: "Summarize" },
  { value: "GENERATE_REPORT", label: "Generate report" },
  { value: "QUERY_LIVE_DATA", label: "Query live data" },
];

const THINK_LEVEL_OPTIONS: Array<SelectMenuOption<ThinkLevel>> = [
  { value: "DEFAULT", label: "ตามค่าบอต", hint: "ใช้ระดับที่ตั้งไว้ในบอต" },
  { value: "low", label: "คิดเร็ว", hint: "ตอบไวที่สุด" },
  { value: "medium", label: "คิดกลาง" },
  { value: "high", label: "คิดลึก", hint: "ละเอียดกว่า แต่ช้ากว่ามาก" },
];

export function UniversalChat({
  bots,
  sources,
  conversations,
  selectedConversationId,
  initialMessages,
  historyQuery,
  webSearchAvailable = false,
  initialThinkLevel = "DEFAULT",
}: {
  bots: Array<{ id: string; name: string }>;
  sources: ChatKnowledgeSource[];
  conversations: Array<{
    id: string;
    title: string;
    botName: string;
    lastMessageAt: string;
  }>;
  selectedConversationId?: string;
  initialMessages: Message[];
  historyQuery: string;
  webSearchAvailable?: boolean;
  /** Read from the cookie server-side, so the pill renders it on first paint. */
  initialThinkLevel?: ThinkLevel;
}) {
  const [liveTrace, setLiveTrace] = useState<AgentTraceEntry[]>([]);
  /**
   * The same trace, readable from inside `send`. `send` is async, so its
   * closure holds the `liveTrace` from the render that created it — always the
   * empty array from before the turn started, which silently dropped the
   * reasoning when the turn was assembled.
   */
  const liveTraceRef = useRef<AgentTraceEntry[]>([]);
  const [scope, setScope] = useState<Scope>("SMART");
  const [mode, setMode] = useState<Mode>("AUTO");
  const [thinkLevel, setThinkLevel] = useState<ThinkLevel>(initialThinkLevel);
  const [botId, setBotId] = useState("");
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [sourcePanelOpen, setSourcePanelOpen] = useState(false);
  const [conversationId, setConversationId] = useState(selectedConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const showBot = scope === "SPECIFIC_BOT";
  const showSources = scope === "SPECIFIC_SOURCES";
  const selectedDocuments = useMemo(
    () => new Set(selectedDocumentIds),
    [selectedDocumentIds],
  );
  const botOptions = useMemo<Array<SelectMenuOption<string>>>(
    () => [
      { value: "", label: "Select bot" },
      ...bots.map((bot) => ({ value: bot.id, label: bot.name })),
    ],
    [bots],
  );
  const selectedSourceScope = useMemo(
    () => selectedChatSourceScope(sources, selectedDocuments),
    [selectedDocuments, sources],
  );

  useEffect(() => {
    if (!sourcePanelOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSourcePanelOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sourcePanelOpen]);

  function startNewChat() {
    setScope("SMART");
    setMode("AUTO");
    setBotId("");
    setSelectedDocumentIds([]);
    setSourcePanelOpen(false);
    setConversationId(undefined);
    setMessages([]);
    setMessage("");
    setPending(false);
    setStreaming(false);
    setError("");
    setWebSearch(false);
    setAttachedFiles([]);
    setLiveTrace([]);
    liveTraceRef.current = [];
    // Drop the conversation from the URL without a navigation, matching how a
    // finished turn updates it.
    window.history.replaceState(null, "", "/workspace/chat");
  }

  async function send() {
    const filesToSend = attachedFiles;
    const content =
      message.trim() ||
      (filesToSend.length ? "Please summarize the attached file(s)." : "");
    if (!content || pending) return;
    if (showBot && !botId) {
      setError("Select a bot for Specific Bot scope.");
      return;
    }
    if (showSources && !selectedDocumentIds.length) {
      setError("Select at least one source or file.");
      setSourcePanelOpen(true);
      return;
    }
    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      role: "USER",
      content,
      citations: [],
      attachments: filesToSend.map((file) => file.name),
    };
    const streamingId = `streaming-${Date.now()}`;
    setMessages((items) => [
      ...items,
      optimistic,
      { id: streamingId, role: "ASSISTANT", content: "", citations: [] },
    ]);
    setMessage("");
    setAttachedFiles([]);
    setPending(true);
    setError("");
    setLiveTrace([]);
    liveTraceRef.current = [];
    try {
      const requestPayload = {
        conversationId,
        message: content,
        scope,
        mode,
        botId: showBot ? botId : undefined,
        sourceIds: showSources ? selectedSourceScope.sourceIds : [],
        documentIds: showSources ? selectedSourceScope.documentIds : [],
        webSearch,
        ...(thinkLevel === "DEFAULT" ? {} : { reasoningEffort: thinkLevel }),
      };
      const formData = new FormData();
      formData.set("payload", JSON.stringify(requestPayload));
      filesToSend.forEach((file) => formData.append("attachments", file));
      const response = await fetch("/api/universal-chat", {
        method: "POST",
        ...(filesToSend.length
          ? { body: formData }
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(requestPayload),
            }),
      });
      const payload = await readChatStream<ChatTurnResult>(response, {
        onStepEvent(event) {
          // The ref is the source of truth and is advanced synchronously:
          // a state updater function runs during React's render phase, not at
          // call time, so assigning the ref inside one left it empty when the
          // finished turn was assembled.
          liveTraceRef.current = applyStepEvent(liveTraceRef.current, event);
          setLiveTrace(liveTraceRef.current);
        },
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
      // Read the trace here, not inside the updater below. React runs a state
      // updater during the render phase, by which time `finally` has already
      // cleared the ref — which is how the reasoning kept vanishing the moment
      // the answer appeared.
      const completedTrace = mergeTrace(
        liveTraceRef.current,
        assistantMessage.toolTimeline ?? [],
      );
      setMessages((items) => [
        ...items.filter(
          (item) => item.id !== optimistic.id && item.id !== streamingId,
        ),
        { ...userMessage, role: "USER", citations: [] },
        { ...assistantMessage, trace: completedTrace },
      ]);
      // The URL is updated without a router navigation on purpose. The chat
      // page is keyed by conversation id, so navigating here would remount
      // this component and replace local state with what the server has —
      // discarding the reasoning trace, which is never persisted, and the
      // answer itself whenever the turn could not be saved.
      window.history.replaceState(
        null,
        "",
        `/workspace/chat?conversation=${encodeURIComponent(conversation.id)}`,
      );
    } catch (reason) {
      setAttachedFiles(filesToSend);
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
      setLiveTrace([]);
      liveTraceRef.current = [];
    }
  }

  return (
    <div
      className={`grid min-h-[calc(100dvh-10rem)] gap-5 xl:grid-cols-[290px_minmax(0,1fr)] ${sourcePanelOpen ? "2xl:grid-cols-[290px_minmax(0,1fr)_320px]" : ""}`}
    >
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
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <div className="text-sm">
              <span className="mb-1 block font-medium">Scope</span>
              <SelectMenu
                label="Scope"
                value={scope}
                options={SCOPE_OPTIONS}
                onChange={(nextScope) => {
                  setScope(nextScope);
                  if (nextScope === "SPECIFIC_SOURCES")
                    setSourcePanelOpen(true);
                }}
              />
            </div>
            <div className="text-sm">
              <span className="mb-1 block font-medium">Mode</span>
              <SelectMenu
                label="Mode"
                value={mode}
                options={MODE_OPTIONS}
                onChange={setMode}
              />
            </div>
            {showBot ? (
              <div className="text-sm md:col-span-2">
                <span className="mb-1 block font-medium">Bot</span>
                <SelectMenu
                  label="Bot"
                  value={botId}
                  options={botOptions}
                  onChange={setBotId}
                />
              </div>
            ) : null}
          </div>
          {showSources ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <Library size={14} aria-hidden="true" />
              {selectedDocumentIds.length ? (
                <>
                  Searching {selectedDocumentIds.length} selected file
                  {selectedDocumentIds.length === 1 ? "" : "s"}. Open Sources to
                  change the selection.
                </>
              ) : (
                <>Choose at least one folder or file from Sources.</>
              )}
            </p>
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
          {messages.map((item) => {
            const trace = messageTrace(item, liveTrace);
            const streaming = item.id.startsWith("streaming-");
            return (
              <article
                key={item.id}
                className={`max-w-3xl ${item.role === "USER" ? "ml-auto" : "mr-auto"}`}
              >
                {/* The trace comes first because it happened first: the turn
                  reads top to bottom as thinking, then acting, then answering,
                  and nothing shifts position when the answer arrives. */}
                {trace.length ? (
                  <AgentTrace entries={trace} live={streaming} />
                ) : null}
                {item.id.startsWith("unsaved-") ? (
                  <p
                    role="status"
                    className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    คำตอบนี้ส่งถึงคุณแล้วแต่บันทึกลงประวัติไม่สำเร็จ
                    หากรีเฟรชหน้าจะหายไป
                  </p>
                ) : null}
                <div
                  className={`rounded-2xl px-4 py-3 text-sm leading-6 ${item.role === "USER" ? "bg-primary text-primary-foreground whitespace-pre-wrap" : "mt-2 border bg-white"}`}
                >
                  {item.role === "USER" ? (
                    item.content
                  ) : (
                    <MarkdownMessage
                      content={item.content}
                      citations={item.citations}
                    />
                  )}
                  {streaming ? (
                    <span
                      className="ml-0.5 inline-block animate-pulse text-primary motion-reduce:animate-none"
                      aria-hidden="true"
                    >
                      ▍
                    </span>
                  ) : null}
                  <ChatMessageAttachments names={item.attachments} />
                </div>
                {item.suggestedAction ? (
                  <NtopActionCard action={item.suggestedAction} />
                ) : null}
                {item.citations.length ? (
                  <CitationSources citations={item.citations} />
                ) : null}
                {item.errorCode ? (
                  <p className="mt-1 text-xs text-amber-700">
                    Status: {item.errorCode}
                  </p>
                ) : null}
                {item.role === "ASSISTANT" &&
                !item.id.startsWith("pending-") &&
                !streaming &&
                !item.id.startsWith("unsaved-") ? (
                  <div className="mt-2">
                    <MessageFeedbackButtons
                      messageId={item.id}
                      initialRating={item.rating}
                    />
                  </div>
                ) : null}
              </article>
            );
          })}
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
        <div className="border-t bg-card p-4">
          <p role="alert" className="mb-2 text-sm text-destructive">
            {error}
          </p>
          <PromptInput
            value={message}
            onValueChange={setMessage}
            onSubmit={() => void send()}
            loading={pending}
          >
            <PromptInputTextarea
              aria-label="Message AI-Sales"
              placeholder="Ask AI-Sales…"
            />
            {attachedFiles.length ? (
              <div className="px-1 pb-1">
                <ChatSelectedAttachments
                  files={attachedFiles}
                  disabled={pending}
                  onChange={setAttachedFiles}
                />
              </div>
            ) : null}
            <PromptInputToolbar>
              <PromptInputActions>
                <ChatAttachmentPicker
                  files={attachedFiles}
                  disabled={pending}
                  onChange={setAttachedFiles}
                  onError={setError}
                  className="size-11 min-h-11 rounded-full"
                />
                {webSearchAvailable ? (
                  <PromptInputButton
                    active={webSearch}
                    aria-pressed={webSearch}
                    disabled={pending}
                    title="Search the live web for this message"
                    onClick={() => setWebSearch((enabled) => !enabled)}
                  >
                    <Globe2 size={17} aria-hidden="true" /> Search
                  </PromptInputButton>
                ) : null}
                <SelectMenu
                  label="ระดับการคิด"
                  value={thinkLevel}
                  options={THINK_LEVEL_OPTIONS}
                  onChange={(level) => {
                    setThinkLevel(level);
                    rememberThinkLevel(level);
                  }}
                  disabled={pending}
                  variant="pill"
                  side="top"
                  icon={Brain}
                />
                <PromptInputButton
                  active={showSources}
                  aria-controls="chat-source-panel"
                  aria-expanded={sourcePanelOpen}
                  onClick={() => setSourcePanelOpen((open) => !open)}
                >
                  <Library size={17} aria-hidden="true" /> Sources
                  {selectedDocumentIds.length ? (
                    <span className="rounded-full bg-primary px-1.5 py-0.5 text-[11px] leading-none font-bold text-primary-foreground tabular-nums">
                      {selectedDocumentIds.length}
                    </span>
                  ) : null}
                </PromptInputButton>
              </PromptInputActions>
              <PromptInputSubmit
                disabled={!message.trim() && !attachedFiles.length}
              />
            </PromptInputToolbar>
          </PromptInput>
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span>Enter to send · Shift + Enter for a new line</span>
            <span>Attach up to 3 supported documents.</span>
            {webSearch ? (
              <span className="font-medium text-foreground">
                Live web sources are on for this message.
              </span>
            ) : null}
          </p>
        </div>
      </section>
      {sourcePanelOpen ? (
        <>
          <button
            type="button"
            aria-label="Close source panel"
            onClick={() => setSourcePanelOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-slate-950/20 backdrop-blur-[1px] 2xl:hidden"
          />
          <ChatSourcePanel
            sources={sources}
            selectedDocumentIds={selectedDocuments}
            onSelectionChange={(ids) => {
              setSelectedDocumentIds(ids);
              setScope(ids.length ? "SPECIFIC_SOURCES" : "SMART");
              setError("");
            }}
            onClose={() => setSourcePanelOpen(false)}
          />
        </>
      ) : null}
    </div>
  );
}
