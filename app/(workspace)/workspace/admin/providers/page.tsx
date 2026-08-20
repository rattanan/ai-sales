import Link from "next/link";
import { ProviderTestButton } from "@/components/admin/phase1-forms";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { deleteLlmProviderAction } from "@/features/admin/config-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function LlmProvidersPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const providers = await db.llmProvider.findMany({
    where: { organizationId: context.organizationId },
    include: { credential: { select: { id: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="LLM providers"
        description="Review provider health and open a dedicated page when creating or editing configuration."
        action={
          <Link
            href="/workspace/admin/providers/new"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
          >
            Add provider
          </Link>
        }
      />
      <section className="grid gap-4 xl:grid-cols-2" aria-label="LLM providers">
        {providers.map((provider) => (
          <article key={provider.id} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">{provider.name}</h2>
                <p className="mt-1 break-all text-sm text-muted-foreground">
                  {provider.baseUrl}
                </p>
              </div>
              <div className="flex gap-2">
                <Badge tone={provider.active ? "success" : "neutral"}>
                  {provider.active ? "ACTIVE" : "INACTIVE"}
                </Badge>
                <Badge
                  tone={
                    provider.lastHealthStatus === "HEALTHY"
                      ? "success"
                      : provider.lastHealthStatus === "UNHEALTHY"
                        ? "danger"
                        : "neutral"
                  }
                >
                  {provider.lastHealthStatus}
                </Badge>
              </div>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Chat model</dt>
                <dd className="font-medium">{provider.chatModel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Embedding model</dt>
                <dd className="font-medium">{provider.embeddingModel}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">API key</dt>
                <dd className="font-medium">
                  {provider.credential ? "Configured" : "Not configured"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last tested</dt>
                <dd className="font-medium">
                  {provider.lastTestedAt?.toLocaleString() ?? "Never"}
                </dd>
              </div>
            </dl>
            {provider.lastHealthMessage ? (
              <p className="mt-4 rounded-lg bg-muted p-3 text-sm text-muted-foreground">
                {provider.lastHealthMessage}
              </p>
            ) : null}
            <div className="mt-5 flex flex-wrap gap-2 border-t pt-4">
              <Link
                href={`/workspace/admin/providers/${provider.id}/edit`}
                className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Edit provider
              </Link>
              <ProviderTestButton providerId={provider.id} />
              <form action={deleteLlmProviderAction}>
                <input type="hidden" name="providerId" value={provider.id} />
                <button className="min-h-11 rounded-lg border border-red-200 px-4 text-sm font-medium text-red-700">
                  Delete
                </button>
              </form>
            </div>
          </article>
        ))}
        {!providers.length ? (
          <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground xl:col-span-2">
            No providers configured yet.
          </p>
        ) : null}
      </section>
    </div>
  );
}
