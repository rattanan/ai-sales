import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { LegacyApiRegistryForm } from "@/components/admin/legacy-api-registry-form";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";

export const metadata = { title: "Add API Tool" };

export default async function NewApiToolPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string }>;
}) {
  const [context, query] = await Promise.all([
    requireAuthorization(),
    searchParams,
  ]);
  await requirePermission(context, "legacy_api.manage");
  const bots = await db.bot.findMany({
    where: { organizationId: context.organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Sources · API Tools"
        title="Add API Tool"
        description="Register one read-only endpoint operation. After saving it, return to API Tools to add another operation—there is no limit of one tool per workspace."
        action={
          <Button asChild variant="outline">
            <Link href="/workspace/sources/api-tools">
              <ArrowLeft size={17} aria-hidden="true" /> API Tools
            </Link>
          </Button>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <LegacyApiRegistryForm key={query.after ?? "new"} bots={bots} />
      </section>
    </div>
  );
}
