import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { BotAppearanceForm } from "@/components/knowledge/bot-appearance-form";
import { BotSettingsNav } from "@/components/knowledge/bot-settings-nav";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

const tabs = [
  "overview",
  "prompt-model",
  "sources",
  "api-tools",
  "playground",
  "appearance",
  "embed-integration",
  "conversation-history",
  "analytics",
] as const;

export default async function BotDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, query, context] = await Promise.all([
    params,
    searchParams,
    requireAuthorization(),
  ]);
  await requirePermission(context, "bot.manage");
  const bot = await db.bot.findFirst({
    where: { id, organizationId: context.organizationId },
    include: {
      providerConfig: { include: { chatEndpoint: true, provider: true } },
      knowledgeSources: {
        include: { source: { include: { rack: true } } },
        orderBy: { priority: "asc" },
      },
      dataSources: {
        include: { dataSource: true },
        orderBy: { priority: "asc" },
      },
      legacyApis: {
        include: { legacyApi: true },
        orderBy: { priority: "asc" },
      },
      conversations: {
        where: { deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        take: 25,
        include: {
          user: { select: { name: true, email: true } },
          messages: {
            where: { role: "ASSISTANT" },
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              citations: { orderBy: { rank: "asc" } },
              retrievalTraces: { orderBy: { rank: "asc" } },
              toolTraces: true,
            },
          },
        },
      },
      _count: { select: { conversations: true } },
    },
  });
  if (!bot) notFound();
  const tab = tabs.includes(query.tab as never) ? query.tab! : "overview";
  const globalSources = await db.knowledgeSource.findMany({
    where: {
      rack: { organizationId: context.organizationId },
      scope: "GLOBAL",
      active: true,
    },
    include: { rack: true },
    orderBy: { name: "asc" },
  });
  const assignedIds = new Set(
    bot.knowledgeSources.map((item) => item.sourceId),
  );
  const canChat = await hasPermission(context, "bot.use");
  return (
    <div className="space-y-6">
      <PageHeader
        title={bot.name}
        description={bot.description ?? "Versioned enterprise knowledge bot"}
        action={
          <div className="flex flex-wrap gap-2">
            <Link
              href="/workspace/admin/bots"
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Back to bots
            </Link>
            {bot.active && canChat ? (
              <Link
                href={`/workspace/chat/${bot.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              >
                <MessageCircle size={17} aria-hidden="true" />
                Chat
              </Link>
            ) : null}
          </div>
        }
      />
      <BotSettingsNav botId={bot.id} current={tab} />
      {tab === "overview" ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[
            ["Status", bot.active ? "Enabled" : "Disabled"],
            ["Version", bot.currentVersion],
            ["Conversations", bot._count.conversations],
            ["Tools", bot.dataSources.length + bot.legacyApis.length],
          ].map(([label, value]) => (
            <section
              key={String(label)}
              className="rounded-xl border bg-card p-5"
            >
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {label}
              </p>
              <p className="mt-2 text-2xl font-semibold">{value}</p>
            </section>
          ))}
        </div>
      ) : null}
      {tab === "prompt-model" ? (
        <section className="grid gap-5 rounded-xl border bg-card p-5 lg:grid-cols-2">
          <div>
            <h2 className="font-semibold">Personal system prompt</h2>
            <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-muted p-4 text-sm">
              {bot.systemPrompt}
            </pre>
          </div>
          <dl className="grid content-start gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Chat endpoint</dt>
              <dd className="font-medium">
                {bot.providerConfig?.chatEndpoint?.name ??
                  bot.providerConfig?.provider?.name ??
                  "Active organization endpoint"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Model override</dt>
              <dd className="font-medium">
                {bot.providerConfig?.model ?? "Endpoint default"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Temperature / tokens</dt>
              <dd className="font-medium">
                {bot.providerConfig?.temperature ?? 0.1} /{" "}
                {bot.providerConfig?.maxTokens ?? 2048}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Memory</dt>
              <dd className="font-medium">
                {bot.providerConfig?.memoryMode ?? "CONVERSATION"}
              </dd>
            </div>
          </dl>
          <Link
            href={`/workspace/admin/bots/${bot.id}/edit`}
            className="min-h-11 w-fit rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            Edit versioned configuration
          </Link>
        </section>
      ) : null}
      {tab === "sources" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Global sources</h2>
            <div className="mt-4 space-y-3">
              {globalSources.map((source) => (
                <div key={source.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{source.name}</span>
                    <Badge
                      tone={source.status === "READY" ? "success" : "warning"}
                    >
                      {source.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {source.rack.name} · ACL checked per actor
                  </p>
                </div>
              ))}
              {!globalSources.length ? (
                <p className="text-sm text-muted-foreground">
                  No global sources.
                </p>
              ) : null}
            </div>
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Assigned sources & overrides</h2>
            <div className="mt-4 space-y-3">
              {bot.knowledgeSources.map((item) => (
                <div key={item.sourceId} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{item.source.name}</span>
                    <Badge tone={item.enabled ? "success" : "neutral"}>
                      {item.enabled ? "ON" : "OFF"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Priority {item.priority} · {item.source.rack.name}
                    {assignedIds.has(item.sourceId) ? "" : " · inherited"}
                  </p>
                </div>
              ))}
              {!bot.knowledgeSources.length ? (
                <p className="text-sm text-muted-foreground">
                  No selected source assignments.
                </p>
              ) : null}
            </div>
            <Link
              href="/workspace/sources"
              className="mt-4 inline-block min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
            >
              Manage source assignments
            </Link>
          </section>
        </div>
      ) : null}
      {tab === "api-tools" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">Database tools</h2>
            <ul className="mt-4 space-y-3">
              {bot.dataSources.map((item) => (
                <li
                  key={item.dataSourceId}
                  className="rounded-lg border p-3 text-sm"
                >
                  <span className="font-medium">{item.dataSource.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    Priority {item.priority} ·{" "}
                    {item.enabled ? "Enabled" : "Disabled"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rounded-xl border bg-card p-5">
            <h2 className="font-semibold">API tools</h2>
            <ul className="mt-4 space-y-3">
              {bot.legacyApis.map((item) => (
                <li
                  key={item.legacyApiId}
                  className="rounded-lg border p-3 text-sm"
                >
                  <span className="font-medium">{item.legacyApi.name}</span>
                  <span className="ml-2 text-muted-foreground">
                    Priority {item.priority} ·{" "}
                    {item.enabled ? "Enabled" : "Disabled"}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      ) : null}
      {tab === "playground" ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Bot playground & admin trace</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the real bot chat pipeline, then return here to inspect
            persisted retrieval and masked tool traces.
          </p>
          <Link
            href={`/workspace/chat/${bot.id}`}
            className="mt-4 inline-block min-h-11 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground"
          >
            Open playground chat
          </Link>
          <div className="mt-6 space-y-3">
            {bot.conversations.flatMap((conversation) =>
              conversation.messages.map((message) => (
                <article key={message.id} className="rounded-lg border p-4">
                  <p className="text-sm font-medium">
                    {conversation.title} ·{" "}
                    {conversation.user.name ?? conversation.user.email}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Retrieved {message.retrievalTraces.length} chunks ·{" "}
                    {message.citations.length} citations ·{" "}
                    {message.toolTraces.length} tool trace(s) ·{" "}
                    {message.inputTokens ?? 0}/{message.outputTokens ?? 0}{" "}
                    tokens · {message.latencyMs ?? 0} ms
                    {message.errorCode ? ` · ${message.errorCode}` : ""}
                  </p>
                  {message.retrievalTraces.length ? (
                    <ol className="mt-3 space-y-2 text-xs">
                      {message.retrievalTraces.map((trace) => (
                        <li key={trace.id}>
                          #{trace.rank} · score {trace.score.toFixed(3)} ·{" "}
                          {trace.sourceType} · source {trace.sourceId ?? "—"} ·
                          chunk {trace.chunkId ?? "—"}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {message.citations.length ? (
                    <ol className="mt-3 space-y-2 text-xs">
                      {message.citations.map((citation) => (
                        <li key={citation.id} className="rounded bg-muted p-2">
                          Citation [{citation.rank}] · {citation.quote}
                        </li>
                      ))}
                    </ol>
                  ) : null}
                  {message.toolTraces.map((trace) => (
                    <pre
                      key={trace.id}
                      className="mt-2 overflow-auto rounded bg-muted p-3 text-xs"
                    >
                      {JSON.stringify(
                        {
                          tool: trace.toolType,
                          status: trace.status,
                          durationMs: trace.durationMs,
                          input: trace.maskedInput,
                          output: trace.maskedOutput,
                          error: trace.errorCode,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  ))}
                </article>
              )),
            )}
            {!bot.conversations.length ? (
              <p className="text-sm text-muted-foreground">
                No test conversations yet.
              </p>
            ) : null}
          </div>
        </section>
      ) : null}
      {tab === "appearance" ? (
        <BotAppearanceForm
          bot={{
            id: bot.id,
            name: bot.name,
            welcomeMessage: bot.welcomeMessage,
            placeholder: bot.placeholder,
            avatarUrl: bot.avatarUrl,
            launcherIcon: bot.launcherIcon,
            primaryColor: bot.primaryColor,
            headerColor: bot.headerColor,
            chatBubbleColor: bot.chatBubbleColor,
            fontFamily: bot.fontFamily as "system" | "sans" | "serif" | "mono",
            colorMode: bot.colorMode as "LIGHT" | "DARK" | "AUTO",
            widgetSize: ["COMPACT", "STANDARD", "LARGE"].includes(
              bot.widgetSize,
            )
              ? (bot.widgetSize as "COMPACT" | "STANDARD" | "LARGE")
              : "STANDARD",
            launcherSize:
              Number.isInteger(bot.launcherSize) && bot.launcherSize >= 40
                ? bot.launcherSize
                : 56,
            windowPosition: bot.windowPosition as "LEFT" | "RIGHT",
            brandingEnabled: bot.brandingEnabled,
          }}
        />
      ) : null}
      {tab === "embed-integration" ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Embed & integration</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Uses the existing backward-compatible widget loader and Embedded
            Authentication flow.
          </p>
          <pre className="mt-4 overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-white">{`<script src="/widget/v1.js" data-bot-id="${bot.id}" async></script>`}</pre>
          <Link
            href="/workspace/admin/authentication"
            className="mt-4 inline-block min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            Configure embedded authentication
          </Link>
        </section>
      ) : null}
      {tab === "conversation-history" ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Conversation history</h2>
          <div className="mt-4 space-y-2">
            {bot.conversations.map((conversation) => (
              <div
                key={conversation.id}
                className="rounded-lg border p-3 text-sm"
              >
                <span className="font-medium">{conversation.title}</span>
                <span className="ml-2 text-muted-foreground">
                  {conversation.user.name ?? conversation.user.email} ·{" "}
                  {conversation.lastMessageAt.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/workspace/insights/chat-history"
            className="mt-4 inline-block min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            Open governed history
          </Link>
        </section>
      ) : null}
      {tab === "analytics" ? (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="font-semibold">Bot analytics</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {bot._count.conversations} retained conversations.
          </p>
          <Link
            href={`/workspace/analytics/overview?botId=${bot.id}`}
            className="mt-4 inline-block min-h-11 rounded-lg border px-4 py-2.5 text-sm font-medium"
          >
            Open deterministic metrics
          </Link>
        </section>
      ) : null}
    </div>
  );
}
