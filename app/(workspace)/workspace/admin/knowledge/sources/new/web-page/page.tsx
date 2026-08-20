import Link from "next/link";
import { WebSourceForm } from "@/components/knowledge/phase4-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function NewWebPageSourcePage() {
  const context = await requireAuthorization();
  await requirePermission(context, "knowledge.manage");
  const racks = await db.knowledgeRack.findMany({
    where: { organizationId: context.organizationId, active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Web page sources"
        title="Add web page"
        description="Connect a public HTTP(S) page with controlled crawling, redirects, and response limits."
        action={
          <Link
            href="/workspace/admin/knowledge/sources?type=WEB"
            className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to web pages
          </Link>
        }
      />
      <section className="max-w-4xl rounded-xl border bg-card p-5 sm:p-6">
        <WebSourceForm racks={racks} />
      </section>
    </div>
  );
}
