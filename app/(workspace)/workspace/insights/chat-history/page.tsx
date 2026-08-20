import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { chatAuditReasonSchema } from "@/schemas/business-insight";
import { db } from "@/server/db";

export default async function GovernedChatHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string; q?: string; page?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "chat.audit");
  const parsed = chatAuditReasonSchema.safeParse({
    reason: query.reason,
    query: query.q,
    page: query.page,
  });
  if (!parsed.success)
    return (
      <div className="space-y-6">
        <PageHeader
          title="Governed chat history"
          description="Manager and administrator access requires a documented reason and creates an audit event. Managers remain limited to their department/project scope."
        />
        <form
          method="get"
          className="max-w-2xl space-y-4 rounded-xl border bg-card p-5"
        >
          <label className="block text-sm font-medium" htmlFor="audit-reason">
            Access reason
          </label>
          <textarea
            id="audit-reason"
            name="reason"
            rows={4}
            minLength={10}
            maxLength={500}
            required
            className="w-full rounded-lg border bg-background p-3 text-sm"
            placeholder="Describe the support, compliance, or quality-review purpose."
          />
          <button className="min-h-11 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
            Record reason and continue
          </button>
        </form>
      </div>
    );
  const [admin, membership] = await Promise.all([
    hasPermission(context, "role.manage"),
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: context.organizationId,
          userId: context.userId,
        },
      },
      include: { projects: true },
    }),
  ]);
  const projectIds =
    membership?.projects.map(({ projectId }) => projectId) ?? [];
  const scope = admin
    ? {}
    : membership?.organizationUnitId || projectIds.length
      ? {
          OR: [
            ...(membership?.organizationUnitId
              ? [{ organizationUnitId: membership.organizationUnitId }]
              : []),
            ...(projectIds.length ? [{ projectId: { in: projectIds } }] : []),
          ],
        }
      : { userId: context.userId };
  const where = {
    organizationId: context.organizationId,
    deletedAt: null,
    AND: [
      scope,
      ...(parsed.data.query
        ? [
            {
              OR: [
                {
                  title: {
                    contains: parsed.data.query,
                    mode: "insensitive" as const,
                  },
                },
                {
                  messages: {
                    some: {
                      content: {
                        contains: parsed.data.query,
                        mode: "insensitive" as const,
                      },
                    },
                  },
                },
              ],
            },
          ]
        : []),
    ],
  };
  const [count, conversations] = await Promise.all([
    db.conversation.count({ where }),
    db.conversation.findMany({
      where,
      include: {
        bot: { select: { name: true } },
        user: { select: { name: true, email: true } },
        messages: {
          include: {
            feedback: true,
            citations: { orderBy: { rank: "asc" } },
          },
          orderBy: { createdAt: "asc" },
        },
        summaries: { orderBy: { version: "desc" }, take: 1 },
      },
      orderBy: { lastMessageAt: "desc" },
      skip: (parsed.data.page - 1) * 20,
      take: 20,
    }),
  ]);
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "CHAT_HISTORY_ACCESSED",
      entityType: "Conversation",
      outcome: "SUCCESS",
      metadata: {
        reason: parsed.data.reason,
        queryUsed: Boolean(parsed.data.query),
        page: parsed.data.page,
        resultCount: conversations.length,
        scope: admin ? "ORGANIZATION" : "DEPARTMENT_PROJECT",
      },
    },
  });
  const pages = Math.max(1, Math.ceil(count / 20));
  const link = (page: number) =>
    `/workspace/insights/chat-history?reason=${encodeURIComponent(parsed.data.reason)}&q=${encodeURIComponent(parsed.data.query ?? "")}&page=${page}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Governed chat history"
        description={`Audited ${admin ? "organization" : "department/project"} scope · reason recorded · ${count} conversations found.`}
      />
      <div className="flex flex-wrap gap-3">
        <Link
          href="/workspace/insights"
          className="min-h-11 rounded-lg border px-4 py-3 text-sm font-medium"
        >
          Back to insights
        </Link>
      </div>
      <form
        method="get"
        className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-[1fr_2fr_auto]"
      >
        <input type="hidden" name="reason" value={parsed.data.reason} />
        <label className="text-sm">
          <span className="mb-1 block font-medium">Search</span>
          <input
            name="q"
            defaultValue={parsed.data.query}
            className="min-h-11 w-full rounded-lg border px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">Recorded access reason</span>
          <input
            value={parsed.data.reason}
            readOnly
            className="min-h-11 w-full rounded-lg border bg-muted px-3"
          />
        </label>
        <button className="min-h-11 self-end rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground">
          Search
        </button>
      </form>
      <div className="space-y-4">
        {conversations.map((conversation) => (
          <details
            key={conversation.id}
            className="rounded-xl border bg-card p-5"
          >
            <summary className="min-h-11 cursor-pointer list-none">
              <span className="font-medium">{conversation.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">
                {conversation.user.name ?? conversation.user.email} ·{" "}
                {conversation.bot.name} ·{" "}
                {conversation.departmentName ?? "No department"} ·{" "}
                {conversation.projectName ?? "No project"} ·{" "}
                {conversation.authMode} · {conversation.messages.length}{" "}
                messages
              </span>
            </summary>
            {conversation.summaries[0] ? (
              <div className="my-4 rounded-lg bg-indigo-50 p-3 text-sm text-indigo-950">
                <p className="font-medium">
                  Summary v{conversation.summaries[0].version}
                </p>
                <p className="mt-1">{conversation.summaries[0].summary}</p>
                <p className="mt-2 text-xs">
                  {conversation.summaries[0].model} ·{" "}
                  {conversation.summaries[0].promptVersion} ·{" "}
                  {conversation.summaries[0].messageIds.length} referenced
                  messages
                </p>
              </div>
            ) : null}
            <ol className="space-y-3 border-t pt-4">
              {conversation.messages.map((message) => (
                <li
                  key={message.id}
                  className="rounded-lg bg-muted p-3 text-sm"
                >
                  <div className="flex flex-wrap justify-between gap-2 text-xs font-medium text-muted-foreground">
                    <span>
                      {message.role} · {message.createdAt.toLocaleString()}
                    </span>
                    <span>
                      {message.inputTokens ?? 0}/{message.outputTokens ?? 0}{" "}
                      tokens · {message.latencyMs ?? 0} ms ·{" "}
                      {message.errorCode ?? "OK"}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap">{message.content}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {message.citations.length} citations · feedback{" "}
                    {message.feedback?.rating ?? "—"}{" "}
                    {message.feedback?.reason ?? ""}
                  </p>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
      <nav
        aria-label="Chat history pages"
        className="flex items-center justify-between text-sm"
      >
        {parsed.data.page > 1 ? (
          <Link
            href={link(parsed.data.page - 1)}
            className="min-h-11 rounded-lg border px-4 py-3"
          >
            Previous
          </Link>
        ) : (
          <span />
        )}
        <span>
          {parsed.data.page} / {pages}
        </span>
        {parsed.data.page < pages ? (
          <Link
            href={link(parsed.data.page + 1)}
            className="min-h-11 rounded-lg border px-4 py-3"
          >
            Next
          </Link>
        ) : (
          <span />
        )}
      </nav>
    </div>
  );
}
