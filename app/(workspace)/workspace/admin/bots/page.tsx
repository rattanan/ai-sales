import Image from "next/image";
import Link from "next/link";
import { Bot, MessageCircle, Settings2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { DeleteBotForm } from "@/components/knowledge/phase2-forms";
import { toggleBotAction } from "@/features/knowledge/actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { standardBotIconId } from "@/lib/bot-icons";
import { StandardBotIcon } from "@/components/knowledge/standard-bot-icon";

export default async function BotAdministrationPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "bot.manage");
  const [bots, canChat] = await Promise.all([
    db.bot.findMany({
      where: { organizationId: context.organizationId },
      include: {
        providerConfig: { include: { chatEndpoint: true, provider: true } },
        _count: {
          select: {
            conversations: true,
            knowledgeRacks: true,
            dataSources: true,
            legacyApis: true,
          },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    hasPermission(context, "bot.use"),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bots"
        description="Chat with an assistant or open its settings. Playground, appearance, sources, and integrations are managed inside each bot."
        action={
          <Link
            href="/workspace/admin/bots/new"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Create bot
          </Link>
        }
      />
      <section className="grid gap-4 xl:grid-cols-2" aria-label="Bots">
        {bots.map((bot) => (
          <article
            key={bot.id}
            className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md"
          >
            <div className="p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  {standardBotIconId(bot.avatarUrl) ? (
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                      <StandardBotIcon
                        id={standardBotIconId(bot.avatarUrl)!}
                        className="size-6"
                      />
                    </span>
                  ) : bot.avatarUrl ? (
                    <Image
                      src={bot.avatarUrl}
                      alt=""
                      width={48}
                      height={48}
                      className="size-12 shrink-0 rounded-xl object-cover"
                      unoptimized
                    />
                  ) : (
                    <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                      <Bot size={24} aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0">
                    <h2 className="truncate font-semibold">{bot.name}</h2>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                      {bot.description ?? "Grounded enterprise assistant"}
                    </p>
                  </div>
                </div>
                <Badge tone={bot.active ? "success" : "neutral"}>
                  {bot.active ? "ACTIVE" : "INACTIVE"}
                </Badge>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Version {bot.currentVersion} · {bot._count.conversations}{" "}
                conversations
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted-foreground">Knowledge racks</dt>
                  <dd className="font-medium">{bot._count.knowledgeRacks}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Databases</dt>
                  <dd className="font-medium">{bot._count.dataSources}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">API tools</dt>
                  <dd className="font-medium">{bot._count.legacyApis}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Endpoint</dt>
                  <dd className="truncate font-medium">
                    {bot.providerConfig?.chatEndpoint?.name ??
                      bot.providerConfig?.provider?.name ??
                      "Organization default"}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t bg-slate-50/70 px-5 py-4">
              {bot.active && canChat ? (
                <Link
                  href={`/workspace/chat/${bot.id}`}
                  aria-label={`Chat with ${bot.name}`}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90"
                >
                  <MessageCircle size={17} aria-hidden="true" />
                  Chat
                </Link>
              ) : (
                <button
                  type="button"
                  disabled
                  title={
                    bot.active
                      ? "You do not have permission to use this bot."
                      : "Activate this bot before starting a chat."
                  }
                  className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded-xl bg-slate-200 px-4 text-sm font-semibold text-slate-500"
                >
                  <MessageCircle size={17} aria-hidden="true" />
                  Chat
                </button>
              )}
              <Link
                href={`/workspace/admin/bots/${bot.id}`}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-100"
              >
                <Settings2 size={17} aria-hidden="true" />
                Settings
              </Link>
              <form action={toggleBotAction}>
                <input type="hidden" name="id" value={bot.id} />
                <input
                  type="hidden"
                  name="active"
                  value={String(!bot.active)}
                />
                <button className="min-h-11 rounded-xl px-3 text-sm font-medium text-slate-600 hover:bg-slate-100">
                  {bot.active ? "Deactivate" : "Activate"}
                </button>
              </form>
              <DeleteBotForm botId={bot.id} botName={bot.name} />
            </div>
          </article>
        ))}
        {!bots.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center xl:col-span-2">
            <p className="font-medium">No bots configured yet.</p>
            <Link
              href="/workspace/admin/bots/new"
              className="mt-4 inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
            >
              Create the first bot
            </Link>
          </div>
        ) : null}
      </section>
    </div>
  );
}
