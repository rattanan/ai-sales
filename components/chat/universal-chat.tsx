"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AgentTrace,
  type AgentTraceEntry,
} from "@/components/chat/agent-trace";
import { CitationSources } from "@/components/chat/citation-sources";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ChatArtifactList } from "@/components/chat/chat-artifacts";
import {
  ChatMessageActions,
  ChatMessageEditor,
} from "@/components/chat/chat-message-actions";
import {
  applyStepEvent,
  mergeTrace,
  messageTrace,
  type ReasoningRow,
} from "@/lib/agent-trace";
import {
  Bot,
  Brain,
  Building2,
  Download,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquarePlus,
  Layers,
  Library,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserSearch,
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
import { Button } from "@/components/ui/button";
import { SideSheet } from "@/components/ui/side-sheet";
import { WorkspaceMobileChrome } from "@/components/layout/workspace-mobile-chrome";
import { cn } from "@/lib/utils";
import { rememberThinkLevel, type ThinkLevel } from "@/lib/chat-preferences";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { useComposerReveal } from "@/components/chat/use-composer-reveal";
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { ConversationDeleteButton } from "@/components/chat/conversation-delete-button";
import { readChatStream } from "@/lib/chat-stream";
import { NtopActionCard } from "@/components/chat/ntop-action-card";
import {
  ChatAttachmentPicker,
  ChatMessageAttachments,
  ChatSelectedAttachments,
} from "@/components/chat/chat-attachment-picker";
import type { NtopSuggestedAction } from "@/schemas/ntop";
import type { ChatArtifact } from "@/types/chat-artifact";
import {
  ChatSourcePanel,
  selectedChatSourceScope,
  type ChatKnowledgeSource,
} from "@/components/chat/chat-source-panel";

type Message = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt?: string;
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
  artifacts?: ChatArtifact[];
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
  userMessage: {
    id: string;
    content: string;
    createdAt?: string;
    attachments?: string[];
  };
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

/**
 * What the agent actually does with a sales question, in the order it happens.
 * The duplicate check is a real step rather than a selling point: every NTOP
 * write tool is told to search first, and a write is only ever a proposal
 * waiting on the confirmation card.
 */
const SALES_WORKFLOW = [
  {
    title: "Search",
    detail:
      "Customers, deals, quotations, and products in NTOP, alongside the documents you may access.",
  },
  {
    title: "Check for duplicates",
    detail:
      "NTOP is searched for an existing record before anything is proposed.",
  },
  {
    title: "Propose the record",
    detail:
      "A prospect or an opportunity, written only after you press confirm.",
  },
];

/**
 * Each one drops a usable sentence into the composer and leaves the caret at
 * the end, where the company name goes — the old chips inserted their own
 * label, which was never a question anyone wanted to send.
 */
const STARTER_PROMPTS = [
  {
    icon: UserSearch,
    label: "This customer",
    prompt: "Open opportunities and the latest quotation for customer ",
  },
  {
    icon: Building2,
    label: "A new company",
    prompt:
      "Check NTOP for this company, and propose a prospect if it is not there yet: ",
  },
  {
    icon: FileText,
    label: "Price and specs",
    prompt: "Search the documents for the price and specification of ",
  },
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
  const [historyOpen, setHistoryOpen] = useState(false);
  const [conversationId, setConversationId] = useState(selectedConversationId);
  const [messages, setMessages] = useState(initialMessages);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const [webSearch, setWebSearch] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const { t } = useWorkspaceLocale();
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

  const logRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const {
    composerRef: composerBoxRef,
    composerHidden,
    transcriptPadding,
    trackScroll,
    followLatest,
    revealComposer,
  } = useComposerReveal(message);

  function startPrompt(text: string) {
    setMessage(text);
    revealComposer();
    const field = composerRef.current;
    if (!field) return;
    field.focus();
    // The new value only reaches the DOM on the next paint, so the caret is
    // placed after it lands. Every starter prompt ends where the typing goes on.
    requestAnimationFrame(() =>
      field.setSelectionRange(text.length, text.length),
    );
  }

  useEffect(() => {
    // transcriptPadding is a dependency because the floating composer's height
    // is one: a growing draft would otherwise slide the last message under it.
    followLatest(logRef.current);
  }, [messages, liveTrace, pending, transcriptPadding, followLatest]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setRelativeTimeNow(Date.now()),
      60_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!sourcePanelOpen) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setSourcePanelOpen(false);
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sourcePanelOpen]);

  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  function openHistory() {
    // On a phone each overlay's scrim would cover the other's trigger.
    setSourcePanelOpen(false);
    setHistoryOpen(true);
  }

  function startNewChat() {
    setScope("SMART");
    setMode("AUTO");
    setBotId("");
    setSelectedDocumentIds([]);
    setSourcePanelOpen(false);
    setHistoryOpen(false);
    setConversationId(undefined);
    setMessages([]);
    setMessage("");
    setPending(false);
    setStreaming(false);
    setError("");
    setWebSearch(false);
    setAttachedFiles([]);
    setEditingMessageId(undefined);
    setLiveTrace([]);
    liveTraceRef.current = [];
    // Drop the conversation from the URL without a navigation, matching how a
    // finished turn updates it.
    window.history.replaceState(null, "", "/workspace/chat");
  }

  async function send(
    text = message,
    options: { clearComposer?: boolean; files?: File[] } = {},
  ) {
    const clearComposer = options.clearComposer ?? true;
    const filesToSend = options.files ?? attachedFiles;
    const content =
      text.trim() ||
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
    const submittedAt = new Date().toISOString();
    const optimistic: Message = {
      id: `pending-${Date.now()}`,
      role: "USER",
      content,
      createdAt: submittedAt,
      citations: [],
      attachments: filesToSend.map((file) => file.name),
    };
    const streamingId = `streaming-${Date.now()}`;
    setMessages((items) => [
      ...items,
      optimistic,
      {
        id: streamingId,
        role: "ASSISTANT",
        content: "",
        createdAt: submittedAt,
        citations: [],
        artifacts: [],
      },
    ]);
    if (clearComposer) {
      setMessage("");
      setAttachedFiles([]);
    }
    setEditingMessageId(undefined);
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
        onArtifact(artifact) {
          setMessages((items) =>
            items.map((item) =>
              item.id === streamingId
                ? {
                    ...item,
                    artifacts: [...(item.artifacts ?? []), artifact],
                  }
                : item,
            ),
          );
        },
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
        {
          ...userMessage,
          role: "USER",
          citations: [],
          createdAt: userMessage.createdAt ?? submittedAt,
        },
        {
          ...assistantMessage,
          trace: completedTrace,
          createdAt: assistantMessage.createdAt ?? new Date().toISOString(),
        },
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
      if (clearComposer) setAttachedFiles(filesToSend);
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
      className={cn(
        // The single row is pinned to the space available, so neither column's
        // content can push the composer below the fold.
        "grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] gap-3 sm:gap-5 xl:grid-cols-[290px_minmax(0,1fr)]",
        sourcePanelOpen && "2xl:grid-cols-[290px_minmax(0,1fr)_320px]",
      )}
    >
      <SideSheet
        id="chat-history"
        open={historyOpen}
        onClose={closeHistory}
        label={t("Conversation history")}
        closeLabel={t("Close conversation history")}
        returnFocusTo={historyTriggerRef}
      >
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Link
            href="/workspace/chat"
            onClick={startNewChat}
            className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            <MessageSquarePlus size={17} /> {t("New chat")}
          </Link>
          <form className="relative mt-4">
            <Search
              className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground"
              size={16}
            />
            <input
              name="q"
              defaultValue={historyQuery}
              aria-label={t("Search conversations")}
              placeholder={t("Search conversations")}
              className="min-h-11 w-full rounded-lg border bg-background pl-9 pr-3 text-sm"
            />
          </form>
          <nav
            aria-label="Conversations"
            className="mt-4 min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain"
          >
            {conversations.map((conversation) => {
              const active = conversation.id === conversationId;
              return (
                <div
                  key={conversation.id}
                  className={`flex items-stretch rounded-lg ${active ? "bg-secondary text-secondary-foreground" : "hover:bg-muted"}`}
                >
                  <Link
                    href={`/workspace/chat?conversation=${conversation.id}`}
                    onClick={closeHistory}
                    aria-current={active ? "page" : undefined}
                    className="min-w-0 flex-1 rounded-lg px-3 py-3 text-sm"
                  >
                    <span className="block truncate font-medium">
                      {conversation.title}
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">
                      {conversation.botName} ·{" "}
                      {new Date(
                        conversation.lastMessageAt,
                      ).toLocaleDateString()}
                    </span>
                  </Link>
                  <ConversationDeleteButton
                    conversationId={conversation.id}
                    conversationTitle={conversation.title}
                    onDeleted={active ? startNewChat : undefined}
                  />
                </div>
              );
            })}
            {!conversations.length ? (
              <p className="px-3 py-5 text-sm text-muted-foreground">
                {t("No universal conversations yet.")}
              </p>
            ) : null}
          </nav>
        </div>
      </SideSheet>
      <section
        inert={historyOpen || undefined}
        className="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-card max-sm:rounded-none max-sm:border-0"
      >
        {/* Below lg this row is the only bar on screen, so it also carries the
            shell's menu and account controls and clears the status bar. */}
        <header className="border-b p-3 max-lg:pt-[max(0.75rem,env(safe-area-inset-top))] sm:p-4">
          {/* On a phone the row never wraps: the title gives way so the pills
              stay in the top-right corner. */}
          <div className="flex items-center gap-1.5 sm:gap-2 sm:flex-wrap">
            <WorkspaceMobileChrome slot="start" />
            <Button
              ref={historyTriggerRef}
              type="button"
              variant="outline"
              size="icon"
              className="xl:hidden"
              aria-label={t("Show conversation history")}
              title={t("Show conversation history")}
              aria-controls="chat-history"
              aria-expanded={historyOpen}
              onClick={openHistory}
            >
              <PanelLeftOpen size={18} aria-hidden="true" />
            </Button>
            <Sparkles className="hidden text-primary sm:block" size={20} />
            <h1 className="min-w-0 truncate font-semibold max-sm:flex-1 max-sm:text-sm">
              {t("Universal Chat")}
            </h1>
            <span className="hidden rounded-full bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700 sm:inline-flex">
              {t("ACL enforced")}
            </span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
              <SelectMenu
                label={t("Scope")}
                caption={t("Scope")}
                icon={Layers}
                compactBelow="md"
                value={scope}
                options={SCOPE_OPTIONS}
                variant="pill"
                align="end"
                onChange={(nextScope) => {
                  setScope(nextScope);
                  if (nextScope === "SPECIFIC_SOURCES")
                    setSourcePanelOpen(true);
                }}
              />
              <SelectMenu
                label={t("Mode")}
                caption={t("Mode")}
                icon={SlidersHorizontal}
                compactBelow="md"
                value={mode}
                options={MODE_OPTIONS}
                variant="pill"
                align="end"
                onChange={setMode}
              />
              {showBot ? (
                <SelectMenu
                  label={t("Bot")}
                  caption={t("Bot")}
                  icon={Bot}
                  compactBelow="md"
                  value={botId}
                  options={botOptions}
                  variant="pill"
                  align="end"
                  onChange={setBotId}
                />
              ) : null}
              {conversationId ? (
                <a
                  href={`/api/universal-chat/export?conversation=${conversationId}`}
                  title={t("Export")}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold max-md:size-11 max-md:justify-center max-md:px-0"
                >
                  <Download size={16} aria-hidden="true" />
                  <span className="max-md:sr-only">{t("Export")}</span>
                </a>
              ) : null}
            </div>
            <WorkspaceMobileChrome slot="end" />
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
          ref={logRef}
          role="log"
          aria-live="polite"
          onScroll={(event) => trackScroll(event.currentTarget)}
          style={
            transcriptPadding === undefined
              ? undefined
              : { paddingBottom: transcriptPadding }
          }
          className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-slate-50/60 p-3 transition-[padding] duration-500 ease-out motion-reduce:transition-none sm:space-y-5 sm:p-6"
        >
          {!messages.length ? (
            <div className="mx-auto mt-6 max-w-2xl sm:mt-12">
              <div className="text-center">
                <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-secondary text-secondary-foreground">
                  <Sparkles />
                </span>
                <h2 className="mt-5 text-xl font-semibold">
                  {t("From a question to a record in NTOP")}
                </h2>
              </div>
              <ol className="mx-auto mt-6 max-w-md space-y-3 text-left">
                {SALES_WORKFLOW.map((stage, index) => (
                  <li key={stage.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
                    >
                      {index + 1}
                    </span>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {t(stage.title)}
                      </span>{" "}
                      — {t(stage.detail)}
                    </p>
                  </li>
                ))}
              </ol>
              <div className="mt-7 grid gap-2 sm:grid-cols-3">
                {STARTER_PROMPTS.map(({ icon: Icon, label, prompt }) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => startPrompt(t(prompt))}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-lg border bg-white px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    <Icon size={16} className="shrink-0" />
                    {t(label)}…
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {messages.map((item) => {
            const trace = messageTrace(item, liveTrace);
            const streaming = item.id.startsWith("streaming-");
            const editing =
              item.role === "USER" && editingMessageId === item.id;
            return (
              <article
                key={item.id}
                className={`group/message ${item.role === "USER" ? "ml-auto max-w-[85%] sm:max-w-3xl" : "mr-auto max-w-3xl"}`}
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
                {editing ? (
                  <ChatMessageEditor
                    content={item.content}
                    disabled={pending}
                    onCancel={() => setEditingMessageId(undefined)}
                    onSubmit={(content) =>
                      void send(content, { clearComposer: false, files: [] })
                    }
                  />
                ) : (
                  <div
                    className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 sm:px-4 sm:py-3 ${item.role === "USER" ? "bg-primary text-primary-foreground ml-auto w-fit rounded-br-sm break-words whitespace-pre-wrap" : "mt-2 border bg-white"}`}
                  >
                    {item.role === "USER" ? (
                      item.content
                    ) : (
                      <MarkdownMessage
                        content={item.content}
                        citations={item.citations}
                      />
                    )}
                    {item.role === "ASSISTANT" ? (
                      <ChatArtifactList artifacts={item.artifacts} />
                    ) : null}
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
                )}
                {!editing ? (
                  <ChatMessageActions
                    content={item.content}
                    createdAt={item.createdAt}
                    now={relativeTimeNow}
                    align={item.role === "USER" ? "end" : "start"}
                    disabled={pending}
                    allowCopy={item.role === "USER"}
                    onRetry={
                      item.role === "USER"
                        ? () =>
                            void send(item.content, {
                              clearComposer: false,
                              files: [],
                            })
                        : undefined
                    }
                    onEdit={
                      item.role === "USER"
                        ? () => setEditingMessageId(item.id)
                        : undefined
                    }
                  />
                ) : null}
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
        <div
          ref={composerBoxRef}
          onFocusCapture={revealComposer}
          className={`absolute inset-x-0 bottom-0 transition-transform duration-500 ease-out motion-reduce:transition-none ${composerHidden ? "translate-y-full" : "translate-y-0"}`}
        >
          {/* Replaces the divider: the transcript fades into the composer
              instead of being cut off from it. */}
          <div
            aria-hidden
            className="pointer-events-none h-10 bg-gradient-to-b from-card/0 to-card"
          />
          <div className="bg-card px-3 pb-3 pt-1 sm:px-4 sm:pb-4">
            <p
              role="alert"
              className="mb-2 text-sm text-destructive empty:hidden"
            >
              {error}
            </p>
            <PromptInput
              value={message}
              onValueChange={setMessage}
              onSubmit={() => void send()}
              loading={pending}
              textareaRef={composerRef}
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
                      className="max-sm:size-11 max-sm:px-0"
                      onClick={() => setWebSearch((enabled) => !enabled)}
                    >
                      <Globe2 size={17} aria-hidden="true" />
                      <span className="max-sm:sr-only">{t("Search")}</span>
                    </PromptInputButton>
                  ) : null}
                  <SelectMenu
                    label={t("Think level")}
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
                    compactBelow="sm"
                  />
                  <PromptInputButton
                    active={showSources}
                    aria-controls="chat-source-panel"
                    aria-expanded={sourcePanelOpen}
                    className="max-sm:px-2.5"
                    onClick={() => setSourcePanelOpen((open) => !open)}
                  >
                    <Library size={17} aria-hidden="true" />
                    <span className="max-sm:sr-only">{t("Sources")}</span>
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
            <p className="mt-2 hidden flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground sm:flex">
              <span>Enter to send · Shift + Enter for a new line</span>
              <span>Attach up to 3 supported documents.</span>
              {webSearch ? (
                <span className="font-medium text-foreground">
                  Live web sources are on for this message.
                </span>
              ) : null}
            </p>
          </div>
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
