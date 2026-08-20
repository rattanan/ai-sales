import Link from "next/link";
import { ChevronLeft, FolderOpen, ShieldCheck } from "lucide-react";
import { FolderAccessForm } from "@/components/knowledge/folder-access-form";
import { SourceAssignmentForm } from "@/components/sources/source-forms";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export const metadata = { title: "Knowledge Access" };

export default async function KnowledgeAccessPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "knowledge.manage");
  await requirePermission(context, "bot.manage");
  const [folders, bots] = await Promise.all([
    db.knowledgeRack.findMany({
      where: { organizationId: context.organizationId },
      include: {
        bots: true,
        sources: {
          include: { botAssignments: true },
          orderBy: { name: "asc" },
        },
      },
      orderBy: { name: "asc" },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Knowledge"
        title="Knowledge access"
        description="Manage folder access first, then override individual sources only when they need a different audience."
        action={
          <Link
            href="/workspace/admin/knowledge"
            className="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-white px-4 text-sm font-semibold"
          >
            <ChevronLeft size={17} /> Back to Explorer
          </Link>
        }
      />
      <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-950">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck size={18} /> Two levels of access
        </div>
        <p className="mt-1 leading-6">
          Shared gives every bot access, including bots created later. Specific
          bots limits access to the checked bots. A source can use its own
          setting independently from its folder.
        </p>
      </div>
      <div className="space-y-4">
        {folders.map((folder) => (
          <details
            key={folder.id}
            open={folder.sources.some((source) => source.id === query.source)}
            className="group overflow-hidden rounded-xl border bg-card"
          >
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-3 bg-slate-50 px-5 py-4">
              <FolderOpen size={20} className="text-amber-500" />
              <span className="font-semibold">{folder.name}</span>
              <Badge tone={folder.scope === "GLOBAL" ? "success" : "info"}>
                {folder.scope === "GLOBAL"
                  ? "Shared"
                  : `${folder.bots.length} bots`}
              </Badge>
              <span className="ml-auto text-sm text-muted-foreground">
                {folder.sources.length} sources
              </span>
            </summary>
            <div className="grid gap-6 border-t p-5 xl:grid-cols-[minmax(320px,0.8fr)_minmax(440px,1.2fr)]">
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Folder permission
                </h2>
                <FolderAccessForm
                  folder={{
                    id: folder.id,
                    scope: folder.scope,
                    botIds: folder.bots.map((item) => item.botId),
                  }}
                  bots={bots}
                />
              </section>
              <section className="space-y-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Source overrides
                </h2>
                {folder.sources.map((source) => (
                  <details
                    key={source.id}
                    open={source.id === query.source}
                    className="rounded-lg border"
                  >
                    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4">
                      <span className="min-w-0 flex-1 truncate font-medium">
                        {source.name}
                      </span>
                      <Badge
                        tone={source.scope === "GLOBAL" ? "success" : "info"}
                      >
                        {source.scope === "GLOBAL"
                          ? "Shared"
                          : `${source.botAssignments.length} bots`}
                      </Badge>
                    </summary>
                    <div className="border-t p-4">
                      <SourceAssignmentForm
                        source={{
                          id: source.id,
                          type: "KNOWLEDGE",
                          scope: source.scope,
                          enabled: source.active,
                          botIds: source.botAssignments.map(
                            (item) => item.botId,
                          ),
                          priority: source.botAssignments[0]?.priority ?? 100,
                        }}
                        bots={bots}
                      />
                    </div>
                  </details>
                ))}
              </section>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
