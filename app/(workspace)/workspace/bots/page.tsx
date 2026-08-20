import Image from "next/image";
import Link from "next/link";
import { Bot, MessageCircle } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";
import { standardBotIconId } from "@/lib/bot-icons";
import { StandardBotIcon } from "@/components/knowledge/standard-bot-icon";

export default async function BotSelectionPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "bot.use");
  const botRows = await db.bot.findMany({
    where: {
      organizationId: context.organizationId,
      active: true,
    },
    include: {
      _count: { select: { knowledgeRacks: true } },
      conversations: {
        where: { userId: context.userId, deletedAt: null },
        orderBy: { lastMessageAt: "desc" },
        take: 1,
        select: { id: true },
      },
    },
    orderBy: { name: "asc" },
  });
  const bots = (
    await Promise.all(
      botRows.map(async (bot) => ({
        bot,
        allowed: (await authorizeResource(context, "BOT", bot.id, "USE"))
          .allowed,
      })),
    )
  )
    .filter(({ allowed }) => allowed)
    .map(({ bot }) => bot);
  return (
    <div className="space-y-7">
      <PageHeader
        title="Ask InsightKM"
        description="Choose an assistant. Every answer is grounded in knowledge you are allowed to access."
      />
      <section className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {bots.map((bot) => (
          <Link
            key={bot.id}
            href={`/workspace/chat/${bot.id}${bot.conversations[0] ? `?conversation=${bot.conversations[0].id}` : ""}`}
            className="group rounded-2xl border bg-card p-5 transition hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md motion-reduce:transform-none"
          >
            <div className="flex items-start gap-4">
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
                  className="size-12 rounded-xl object-cover"
                  unoptimized
                />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-indigo-100 text-indigo-700">
                  <Bot size={24} aria-hidden="true" />
                </span>
              )}
              <div className="min-w-0">
                <h2 className="font-semibold group-hover:text-indigo-800">
                  {bot.name}
                </h2>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
                  {bot.description ?? bot.welcomeMessage}
                </p>
              </div>
            </div>
            <div className="mt-5 flex items-center justify-between border-t pt-4 text-xs text-muted-foreground">
              <span>{bot._count.knowledgeRacks} knowledge racks</span>
              <span className="flex items-center gap-1 font-medium text-indigo-700">
                <MessageCircle size={14} /> Open chat
              </span>
            </div>
          </Link>
        ))}
        {!bots.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center md:col-span-2 xl:col-span-3">
            <Bot className="mx-auto text-slate-400" />
            <h2 className="mt-3 font-semibold">No assistants assigned</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Ask an administrator to activate a bot and grant your role access.
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}
