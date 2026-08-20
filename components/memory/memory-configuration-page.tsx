import Link from "next/link";
import { notFound } from "next/navigation";
import { MemoryForm } from "@/components/memory/memory-forms";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { authorizeResource } from "@/server/auth/resource-authorization";

export async function MemoryConfigurationPage({
  memoryId,
}: {
  memoryId?: string;
}) {
  const context = await requireAuthorization();
  const [botRows, memory] = await Promise.all([
    db.bot.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    memoryId
      ? db.userMemory.findFirst({
          where: {
            id: memoryId,
            organizationId: context.organizationId,
            userId: context.userId,
            expiresAt: { gt: new Date() },
          },
          select: {
            id: true,
            botId: true,
            category: true,
            key: true,
            value: true,
          },
        })
      : null,
  ]);

  if (memoryId && !memory) notFound();

  const bots = (
    await Promise.all(
      botRows.map(async (bot) => ({
        ...bot,
        allowed: (await authorizeResource(context, "BOT", bot.id, "USE"))
          .allowed,
      })),
    )
  )
    .filter(({ allowed }) => allowed)
    .map(({ id, name }) => ({ id, name }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={memory ? `Edit ${memory.key}` : "Add memory"}
        description="Passwords, tokens, credentials, identifiers, contact details, financial data, and opaque secrets are rejected."
      />
      <Button asChild variant="outline">
        <Link href="/workspace/profile/memory">Back to memory & consent</Link>
      </Button>
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <MemoryForm bots={bots} memory={memory ?? undefined} />
      </section>
    </div>
  );
}
