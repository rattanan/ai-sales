"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Globe2, PanelLeftOpen, Plus, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PromptInput,
  PromptInputActions,
  PromptInputButton,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputToolbar,
} from "@/components/ui/prompt-input";
import { SelectMenu, type SelectMenuOption } from "@/components/ui/select-menu";
import { SideSheet } from "@/components/ui/side-sheet";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { CitationSources } from "@/components/chat/citation-sources";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ChatArtifactList } from "@/components/chat/chat-artifacts";
import {
  ChatMessageActions,
  ChatMessageEditor,
} from "@/components/chat/chat-message-actions";
import { readChatStream } from "@/lib/chat-stream";
import { useComposerReveal } from "@/components/chat/use-composer-reveal";
import { NtopActionCard } from "@/components/chat/ntop-action-card";
import {
  ChatAttachmentPicker,
  ChatMessageAttachments,
  ChatSelectedAttachments,
} from "@/components/chat/chat-attachment-picker";
import type { NtopSuggestedAction } from "@/schemas/ntop";
import type { ChatArtifact } from "@/types/chat-artifact";
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
  createdAt?: string;
  errorCode?: string | null;
  citations: Citation[];
  rating?: number | null;
  suggestedAction?: NtopSuggestedAction;
  attachments?: string[];
  artifacts?: ChatArtifact[];
};

type ChatTurnResult = {
  conversation: { id: string };
  userMessage: {
    id: string;
    content: string;
    createdAt?: string;
    attachments?: string[];
  };
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
  webSearchAvailable = false,
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
  webSearchAvailable?: boolean;
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
  const [webSearch, setWebSearch] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [relativeTimeNow, setRelativeTimeNow] = useState(() => Date.now());
  const [editingMessageId, setEditingMessageId] = useState<string>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTriggerRef = useRef<HTMLButtonElement>(null);
  const closeHistory = useCallback(() => setHistoryOpen(false), []);
  const { t } = useWorkspaceLocale();
  const optimisticSequence = useRef(0);
  const projectOptions = useMemo<Array<SelectMenuOption<string>>>(
    () => [
      { value: "", label: "No project" },
      ...projects.map((project) => ({
        value: project.id,
        label: project.name,
      })),
    ],
    [projects],
  );
  const visibleConversations = useMemo(
    () =>
      conversations.filter(({ title }) =>
        title.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
      ),
    [conversations, search],
  );

  /**
   * The transcript scrolls inside its own box now, so a new answer would land
   * below the fold without this. It only follows while the reader is already at
   * the bottom — scrolling up to re-read something must not be yanked back.
   */
  const logRef = useRef<HTMLOListElement>(null);
  const {
    composerRef,
    composerHidden,
    transcriptPadding,
    trackScroll,
    followLatest,
    revealComposer,
  } = useComposerReveal(input);

  useEffect(() => {
    // transcriptPadding is a dependency because the floating composer's height
    // is one: a growing draft would otherwise slide the last message under it.
    followLatest(logRef.current);
  }, [messages, pending, streaming, transcriptPadding, followLatest]);

  useEffect(() => {
    const interval = window.setInterval(
      () => setRelativeTimeNow(Date.now()),
      60_000,
    );
    return () => window.clearInterval(interval);
  }, []);

  async function send(
    text = input,
    options: { clearComposer?: boolean; files?: File[] } = {},
  ) {
    const clearComposer = options.clearComposer ?? true;
    const filesToSend = options.files ?? attachedFiles;
    const message =
      text.trim() ||
      (filesToSend.length ? "Please summarize the attached file(s)." : "");
    if (!message || pending) return;
    setPending(true);
    setError(undefined);
    if (clearComposer) {
      setInput("");
      setAttachedFiles([]);
    }
    setEditingMessageId(undefined);
    optimisticSequence.current += 1;
    const optimisticId = `pending-${optimisticSequence.current}`;
    const streamingId = `streaming-${optimisticSequence.current}`;
    const submittedAt = new Date().toISOString();
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "USER",
        content: message,
        createdAt: submittedAt,
        citations: [],
        attachments: filesToSend.map((file) => file.name),
      },
      {
        id: streamingId,
        role: "ASSISTANT",
        content: "",
        createdAt: submittedAt,
        citations: [],
        artifacts: [],
      },
    ]);
    try {
      const requestPayload = {
        botId: bot.id,
        conversationId,
        projectId: conversationId ? undefined : projectId || undefined,
        message,
        webSearch,
      };
      const formData = new FormData();
      formData.set("payload", JSON.stringify(requestPayload));
      filesToSend.forEach((file) => formData.append("attachments", file));
      const response = await fetch("/api/knowledge-chat", {
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
          setMessages((current) =>
            current.map((item) =>
              item.id === streamingId
                ? {
                    ...item,
                    artifacts: [...(item.artifacts ?? []), artifact],
                  }
                : item,
            ),
          );
        },
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
      const completedAt = new Date().toISOString();
      setMessages((current) => [
        ...current.filter(
          ({ id }) => id !== optimisticId && id !== streamingId,
        ),
        {
          ...payload.userMessage,
          role: "USER",
          citations: [],
          createdAt: payload.userMessage.createdAt ?? submittedAt,
        },
        {
          ...payload.assistantMessage,
          createdAt: payload.assistantMessage.createdAt ?? completedAt,
        },
      ]);
      if (!conversationId) {
        router.replace(
          `/workspace/chat/${bot.id}?conversation=${payload.conversation.id}`,
        );
        router.refresh();
      }
    } catch (caught) {
      if (clearComposer) setAttachedFiles(filesToSend);
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
    <div className="grid min-h-0 flex-1 overflow-hidden rounded-2xl border bg-card xl:grid-cols-[290px_minmax(0,1fr)]">
      <SideSheet
        id="knowledge-history"
        open={historyOpen}
        onClose={closeHistory}
        label={t("Conversation history")}
        closeLabel={t("Close conversation history")}
        returnFocusTo={historyTriggerRef}
        className="xl:rounded-none xl:border-0 xl:border-r xl:bg-slate-50/80"
      >
        <div className="flex min-h-0 flex-1 flex-col p-4">
          <Button asChild variant="outline" className="w-full">
            <Link href={`/workspace/chat/${bot.id}`} onClick={closeHistory}>
              <Plus size={16} /> {t("New conversation")}
            </Link>
          </Button>
          <form method="get" className="relative mt-4 flex gap-1">
            <label className="relative block min-w-0 flex-1">
              <span className="sr-only">{t("Search conversations")}</span>
              <Search
                className="absolute left-3 top-3.5 text-slate-400"
                size={16}
              />
              <input
                name="q"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search history")}
                className="min-h-11 w-full rounded-lg border bg-white pl-9 pr-3 text-sm"
              />
            </label>
            <button className="min-h-11 rounded-lg border bg-white px-3 text-xs font-medium">
              {t("Find")}
            </button>
          </form>
          <nav
            aria-label="Conversation history"
            className="mt-4 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain"
          >
            {visibleConversations.map((conversation) => (
              <div
                key={conversation.id}
                className={`rounded-lg border p-2 ${conversation.id === conversationId ? "border-indigo-300 bg-indigo-50" : "bg-white"}`}
              >
                <Link
                  href={`/workspace/chat/${bot.id}?conversation=${conversation.id}`}
                  onClick={closeHistory}
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
                onClick={closeHistory}
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
                onClick={closeHistory}
                className="min-h-11 rounded-lg border bg-white px-3 py-3 font-medium"
              >
                Next
              </Link>
            ) : (
              <span />
            )}
          </div>
        </div>
      </SideSheet>
      <section
        inert={historyOpen || undefined}
        className="relative flex min-h-0 min-w-0 flex-col"
      >
        <header className="flex flex-wrap items-center gap-2 border-b px-3 py-3 sm:gap-3 sm:px-5 sm:py-4">
          <Button
            ref={historyTriggerRef}
            type="button"
            variant="outline"
            size="icon"
            className="xl:hidden"
            aria-label={t("Show conversation history")}
            title={t("Show conversation history")}
            aria-controls="knowledge-history"
            aria-expanded={historyOpen}
            onClick={() => setHistoryOpen(true)}
          >
            <PanelLeftOpen size={18} aria-hidden="true" />
          </Button>
          <span className="hidden size-10 place-items-center rounded-xl bg-indigo-100 text-indigo-700 sm:grid">
            <Bot size={20} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-semibold">{bot.name}</h1>
            <p className="hidden text-xs text-muted-foreground sm:block">
              Grounded answers with governed citations
            </p>
          </div>
          {!conversationId && projects.length > 1 ? (
            <div className="ml-auto text-xs text-muted-foreground max-sm:w-full">
              <span className="mb-1 block">Project context</span>
              <SelectMenu
                label="Project context"
                value={projectId}
                options={projectOptions}
                onChange={setProjectId}
                align="end"
              />
            </div>
          ) : null}
        </header>
        <ol
          ref={logRef}
          aria-live="polite"
          onScroll={(event) => trackScroll(event.currentTarget)}
          style={
            transcriptPadding === undefined
              ? undefined
              : { paddingBottom: transcriptPadding }
          }
          className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3 transition-[padding] duration-500 ease-out motion-reduce:transition-none sm:space-y-5 sm:p-7"
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
          {messages.map((message) => {
            const editing =
              message.role === "USER" && editingMessageId === message.id;
            return (
              <li
                key={message.id}
                className={`group/message ${
                  message.role === "USER"
                    ? "ml-auto max-w-[85%] sm:max-w-2xl"
                    : "mr-auto max-w-3xl"
                }`}
              >
                {editing ? (
                  <ChatMessageEditor
                    content={message.content}
                    disabled={pending}
                    onCancel={() => setEditingMessageId(undefined)}
                    onSubmit={(content) =>
                      void send(content, { clearComposer: false, files: [] })
                    }
                  />
                ) : (
                  <article
                    className={
                      message.role === "USER"
                        ? "ml-auto w-fit rounded-2xl rounded-br-sm bg-slate-900 px-4 py-3 text-sm leading-6 text-white"
                        : "rounded-2xl rounded-bl-sm border bg-white px-5 py-4 text-sm leading-7 shadow-sm"
                    }
                  >
                    {message.role === "USER" ? (
                      <p className="break-words whitespace-pre-wrap">
                        {message.content}
                      </p>
                    ) : (
                      <MarkdownMessage
                        content={message.content}
                        citations={message.citations}
                      />
                    )}
                    {message.role === "ASSISTANT" ? (
                      <ChatArtifactList artifacts={message.artifacts} />
                    ) : null}
                    {message.id.startsWith("streaming-") ? (
                      <span
                        className="ml-0.5 inline-block animate-pulse text-indigo-600 motion-reduce:animate-none"
                        aria-hidden="true"
                      >
                        ▍
                      </span>
                    ) : null}
                    <ChatMessageAttachments names={message.attachments} />
                    {message.citations.length ? (
                      <CitationSources citations={message.citations} />
                    ) : null}
                  </article>
                )}
                {!editing ? (
                  <ChatMessageActions
                    content={message.content}
                    createdAt={message.createdAt}
                    now={relativeTimeNow}
                    align={message.role === "USER" ? "end" : "start"}
                    disabled={pending}
                    allowCopy={message.role === "USER"}
                    onRetry={
                      message.role === "USER"
                        ? () =>
                            void send(message.content, {
                              clearComposer: false,
                              files: [],
                            })
                        : undefined
                    }
                    onEdit={
                      message.role === "USER"
                        ? () => setEditingMessageId(message.id)
                        : undefined
                    }
                  />
                ) : null}
                {message.suggestedAction ? (
                  <NtopActionCard action={message.suggestedAction} />
                ) : null}
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
            );
          })}
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
        <div
          ref={composerRef}
          onFocusCapture={revealComposer}
          className={`absolute inset-x-0 bottom-0 transition-transform duration-500 ease-out motion-reduce:transition-none ${composerHidden ? "translate-y-full" : "translate-y-0"}`}
        >
          {/* Replaces the divider: the transcript fades into the composer
              instead of being cut off from it. */}
          <div
            aria-hidden
            className="pointer-events-none h-10 bg-gradient-to-b from-card/0 to-card"
          />
          <div className="bg-card px-3 pb-3 pt-1 sm:px-5 sm:pb-5">
            <p
              aria-live="assertive"
              className="mb-2 text-sm text-destructive empty:hidden"
            >
              {error}
            </p>
            <PromptInput
              value={input}
              onValueChange={setInput}
              onSubmit={() => void send()}
              loading={pending}
              className="mx-auto max-w-4xl"
            >
              <PromptInputTextarea
                aria-label={`Message ${bot.name}`}
                placeholder="Ask about your attached files or permitted knowledge…"
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
                    onError={(message) => setError(message || undefined)}
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
                </PromptInputActions>
                <PromptInputSubmit
                  disabled={!input.trim() && !attachedFiles.length}
                />
              </PromptInputToolbar>
            </PromptInput>
            <p className="mx-auto mt-2 hidden max-w-4xl text-xs text-muted-foreground sm:block">
              Enter to send · Shift + Enter for a new line. Attached files are
              read for this message only and are not added to the Knowledge
              Base.
              {webSearch ? " Live web sources are on for this message." : null}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
