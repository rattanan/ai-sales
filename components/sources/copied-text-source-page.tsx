import Link from "next/link";
import { notFound } from "next/navigation";
import { CopiedTextSourceForm } from "@/components/sources/source-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export async function CopiedTextSourcePage({
  sourceId,
}: {
  sourceId?: string;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const [racks, bots, source] = await Promise.all([
    db.knowledgeRack.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    sourceId
      ? db.knowledgeSource.findFirst({
          where: {
            id: sourceId,
            type: "COPIED_TEXT",
            rack: { organizationId: context.organizationId },
          },
          include: { copiedTextConfig: true, botAssignments: true },
        })
      : Promise.resolve(null),
  ]);
  if (sourceId && (!source || !source.copiedTextConfig)) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Sources · Copied text"
        title={source ? `Edit ${source.name}` : "Create copied text source"}
        description="Store one governed text source, then manage it from the source catalog."
        action={
          <Link
            href="/workspace/sources"
            className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to sources
          </Link>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <CopiedTextSourceForm
          racks={racks}
          bots={bots}
          value={
            source?.copiedTextConfig
              ? {
                  id: source.id,
                  rackId: source.rackId,
                  name: source.name,
                  description: source.description,
                  content: source.copiedTextConfig.content,
                  category: source.category,
                  tags: source.tags,
                  scope: source.scope,
                  botIds: source.botAssignments.map((item) => item.botId),
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}
