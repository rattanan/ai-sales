"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bot, Globe2, Plus, Search, Trash2 } from "lucide-react";
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
import { MessageFeedbackButtons } from "@/components/chat/message-feedback-buttons";
import { CitationSources } from "@/components/chat/citation-sources";
import { MarkdownMessage } from "@/components/chat/markdown-message";
import { ChatArtifactList } from "@/components/chat/chat-artifacts";
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
  suggestedAction?: NtopSuggestedAction;
  attachments?: string[];
  artifacts?: ChatArtifact[];
};

type ChatTurnResult = {
  conversation: { id: string };
  userMessage: { id: string; content: string; attachments?: string[] };
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
  const followingRef = useRef(true);

  useEffect(() => {
    const log = logRef.current;
    if (!log || !followingRef.current) return;
    log.scrollTop = log.scrollHeight;
  }, [messages, pending, streaming]);

  async function send(text = input) {
    const filesToSend = attachedFiles;
    const message =
      text.trim() ||
      (filesToSend.length ? "Please summarize the attached file(s)." : "");
    if (!message || pending) return;
    setPending(true);
    setError(undefined);
    setInput("");
    setAttachedFiles([]);
    optimisticSequence.current += 1;
    const optimisticId = `pending-${optimisticSequence.current}`;
    const streamingId = `streaming-${optimisticSequence.current}`;
    setMessages((current) => [
      ...current,
      {
        id: optimisticId,
        role: "USER",
        content: message,
        citations: [],
        attachments: filesToSend.map((file) => file.name),
      },
      {
        id: streamingId,
        role: "ASSISTANT",
        content: "",
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
      setAttachedFiles(filesToSend);
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
    <div className="grid h-[calc(100dvh-9rem)] min-h-[520px] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[290px_1fr]">
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
      <section className="flex min-h-0 flex-col">
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
            <div className="ml-auto text-xs text-muted-foreground">
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
          onScroll={(event) => {
            const log = event.currentTarget;
            followingRef.current =
              log.scrollHeight - log.scrollTop - log.clientHeight < 48;
          }}
          className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5 sm:p-7"
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
                {message.role === "USER" ? (
                  <p className="whitespace-pre-wrap">{message.content}</p>
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
        <div className="border-t bg-card p-4 sm:p-5">
          <p aria-live="assertive" className="mb-2 text-sm text-destructive">
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
                    onClick={() => setWebSearch((enabled) => !enabled)}
                  >
                    <Globe2 size={17} aria-hidden="true" /> Search
                  </PromptInputButton>
                ) : null}
              </PromptInputActions>
              <PromptInputSubmit
                disabled={!input.trim() && !attachedFiles.length}
              />
            </PromptInputToolbar>
          </PromptInput>
          <p className="mx-auto mt-2 max-w-4xl text-xs text-muted-foreground">
            Enter to send · Shift + Enter for a new line. Attached files are
            read for this message only and are not added to the Knowledge Base.
            {webSearch ? " Live web sources are on for this message." : null}
          </p>
        </div>
      </section>
    </div>
  );
}
