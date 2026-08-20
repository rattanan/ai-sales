import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import {
  DeleteAllMemoriesForm,
  MemoryConsentForm,
} from "@/components/memory/memory-forms";
import { deleteUserMemoryAction } from "@/features/memory/actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";

export default async function UserMemoryPage() {
  const context = await requireAuthorization();
  const [memories, consents, botRows, retention] = await Promise.all([
    db.userMemory.findMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        expiresAt: { gt: new Date() },
      },
      include: { bot: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
    }),
    db.memoryConsent.findMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
      },
      include: { bot: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.systemRetentionPolicy.findUnique({
      where: { organizationId: context.organizationId },
    }),
  ]);
  const bots = (
    await Promise.all(
      botRows.map(async (bot) => ({
        ...bot,
        allowed: (await authorizeResource(context, "BOT", bot.id, "USE"))
          .allowed,
      })),
    )
  ).filter(({ allowed }) => allowed);
  const choices = bots.map(({ id, name }) => ({ id, name }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="My memory & consent"
        description={`Control the preferences and organization context InsightKM may reuse. Active memories expire after ${retention?.memoryRetentionDays ?? 365} days and can be deleted immediately.`}
        action={
          <Button asChild>
            <Link href="/workspace/profile/memory/new">Add memory</Link>
          </Button>
        }
      />
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/workspace/profile">Back to profile</Link>
        </Button>
      </div>
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Consent</h2>
        <p className="mb-5 mt-1 text-sm text-muted-foreground">
          Revoking consent deletes memories in the selected categories while
          retaining an auditable consent decision without memory values.
        </p>
        <MemoryConsentForm bots={choices} />
      </section>
      <section className="space-y-4">
        <div>
          <h2 className="font-semibold">Active memories</h2>
          <p className="text-sm text-muted-foreground">
            Review, edit, or permanently delete each item.
          </p>
        </div>
        <div className="grid gap-4 xl:grid-cols-2">
          {memories.map((memory) => (
            <article key={memory.id} className="rounded-xl border bg-card p-5">
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-3">
                <span className="font-medium">{memory.key}</span>
                <span className="flex gap-2">
                  <Badge>{memory.category}</Badge>
                  <Badge tone="neutral">{memory.bot?.name ?? "ALL BOTS"}</Badge>
                </span>
              </div>
              <p className="my-4 rounded-lg bg-muted p-3 text-sm">
                {memory.value}
              </p>
              <p className="mb-4 text-xs text-muted-foreground">
                Expires {memory.expiresAt.toLocaleString()}
              </p>
              <div className="flex flex-wrap gap-3 border-t pt-4">
                <Button asChild variant="outline">
                  <Link href={`/workspace/profile/memory/${memory.id}/edit`}>
                    Edit
                  </Link>
                </Button>
                <form action={deleteUserMemoryAction}>
                  <input type="hidden" name="id" value={memory.id} />
                  <Button variant="destructive">Delete permanently</Button>
                </form>
              </div>
            </article>
          ))}
          {!memories.length ? (
            <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground xl:col-span-2">
              No active memories. Grant consent before adding one.
            </p>
          ) : null}
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <h2 className="font-semibold">Consent history</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="border-b text-muted-foreground">
              <tr>
                <th className="px-3 py-2">Time</th>
                <th className="px-3 py-2">Decision</th>
                <th className="px-3 py-2">Bot</th>
                <th className="px-3 py-2">Categories</th>
                <th className="px-3 py-2">Policy</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {consents.map((consent) => (
                <tr key={consent.id}>
                  <td className="px-3 py-3">
                    {consent.createdAt.toLocaleString()}
                  </td>
                  <td className="px-3 py-3">{consent.status}</td>
                  <td className="px-3 py-3">
                    {consent.bot?.name ?? "All bots"}
                  </td>
                  <td className="px-3 py-3">{consent.categories.join(", ")}</td>
                  <td className="px-3 py-3">{consent.policyVersion}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="rounded-xl border border-red-200 bg-red-50 p-5 sm:p-6">
        <h2 className="font-semibold text-red-900">Delete all memory data</h2>
        <p className="mb-4 mt-1 text-sm text-red-800">
          This immediately removes every active memory in this organization.
          Consent history remains without stored memory values.
        </p>
        <DeleteAllMemoriesForm />
      </section>
    </div>
  );
}
