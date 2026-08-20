import Link from "next/link";
import { notFound } from "next/navigation";
import { BotConfigurationForm } from "@/components/knowledge/phase2-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

function questions(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export async function BotConfigurationPage({ botId }: { botId?: string }) {
  const context = await requireAuthorization();
  await requirePermission(context, "bot.manage");
  const [
    racks,
    dataSources,
    legacyApis,
    roles,
    users,
    providers,
    chatEndpoints,
    bot,
  ] = await Promise.all([
    db.knowledgeRack.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.dataSource.findMany({
      where: {
        workspaceId: context.workspaceId,
        status: "CONNECTED",
        type: { in: ["MYSQL", "POSTGRESQL", "MSSQL", "ORACLE"] },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.legacyApi.findMany({
      where: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        enabled: true,
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.role.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        memberships: { some: { organizationId: context.organizationId } },
      },
      select: { id: true, name: true, email: true },
      orderBy: { name: "asc" },
    }),
    db.llmProvider.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.aiEndpointConfig.findMany({
      where: { organizationId: context.organizationId, kind: "CHAT" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    botId
      ? db.bot.findFirst({
          where: { id: botId, organizationId: context.organizationId },
          include: {
            providerConfig: true,
            knowledgeRacks: true,
            dataSources: true,
            legacyApis: true,
            access: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (botId && !bot) notFound();
  const userChoices = users.map((user) => ({
    id: user.id,
    name: user.name ?? user.email,
  }));
  const value = bot
    ? {
        id: bot.id,
        name: bot.name,
        description: bot.description,
        avatarUrl: bot.avatarUrl,
        systemPrompt: bot.systemPrompt,
        welcomeMessage: bot.welcomeMessage,
        suggestedQuestions: questions(bot.suggestedQuestions),
        active: bot.active,
        fallbackMessage: bot.fallbackMessage,
        apiToolsEnabled: bot.apiToolsEnabled,
        databaseToolsEnabled: bot.databaseToolsEnabled,
        primaryColor: bot.primaryColor,
        headerColor: bot.headerColor,
        chatBubbleColor: bot.chatBubbleColor,
        fontFamily: bot.fontFamily as "system" | "sans" | "serif" | "mono",
        colorMode: bot.colorMode as "LIGHT" | "DARK" | "AUTO",
        launcherIcon: bot.launcherIcon,
        widgetSize: bot.widgetSize as "COMPACT" | "STANDARD" | "LARGE",
        launcherSize: bot.launcherSize,
        windowPosition: bot.windowPosition as "LEFT" | "RIGHT",
        placeholder: bot.placeholder,
        brandingEnabled: bot.brandingEnabled,
        providerId: bot.providerConfig?.providerId ?? null,
        chatEndpointId: bot.providerConfig?.chatEndpointId ?? null,
        model: bot.providerConfig?.model ?? null,
        temperature: bot.providerConfig?.temperature ?? 0.1,
        maxTokens: bot.providerConfig?.maxTokens ?? 2048,
        contextSize: bot.providerConfig?.contextSize ?? 12000,
        citationEnabled: bot.providerConfig?.citationEnabled ?? true,
        memoryMode: bot.providerConfig?.memoryMode ?? "CONVERSATION",
        rackIds: bot.knowledgeRacks.map(({ rackId }) => rackId),
        dataSourceIds: bot.dataSources.map(({ dataSourceId }) => dataSourceId),
        legacyApiIds: bot.legacyApis.map(({ legacyApiId }) => legacyApiId),
        roleIds: bot.access.flatMap(({ roleId }) => (roleId ? [roleId] : [])),
        userIds: bot.access.flatMap(({ userId }) => (userId ? [userId] : [])),
      }
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Bot studio"
        title={bot ? `Edit ${bot.name}` : "Create bot"}
        description={
          bot
            ? "Update one bot configuration and save it as a new version."
            : "Create one grounded assistant, then return to the bot list."
        }
        action={
          <Link
            href="/workspace/admin/bots"
            className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to bots
          </Link>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <BotConfigurationForm
          bot={value}
          racks={racks}
          roles={roles}
          users={userChoices}
          providers={providers}
          chatEndpoints={chatEndpoints}
          dataSources={dataSources}
          legacyApis={legacyApis}
        />
      </section>
    </div>
  );
}
