import Link from "next/link";
import { KnowledgeRackForm } from "@/components/knowledge/phase2-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function NewKnowledgeRackPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const [roles, bots] = await Promise.all([
    db.role.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
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
        eyebrow="Knowledge Explorer"
        title="Create knowledge folder"
        description="Create a folder for related sources and choose which bots can access it."
        action={
          <Link
            href="/workspace/admin/knowledge"
            className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to Explorer
          </Link>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <KnowledgeRackForm roles={roles} bots={bots} />
      </section>
    </div>
  );
}
