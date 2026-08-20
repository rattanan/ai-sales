import Link from "next/link";
import { notFound } from "next/navigation";
import { LlmProviderForm } from "@/components/admin/phase1-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export async function ProviderConfigurationPage({
  providerId,
}: {
  providerId?: string;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const provider = providerId
    ? await db.llmProvider.findFirst({
        where: { id: providerId, organizationId: context.organizationId },
        include: { credential: { select: { id: true } } },
      })
    : null;
  if (providerId && !provider) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="LLM providers"
        title={provider ? `Edit ${provider.name}` : "Add provider"}
        description="API keys are encrypted at rest and are never returned to the browser."
        action={
          <Link
            href="/workspace/admin/providers"
            className="inline-flex min-h-11 items-center rounded-lg border px-4 text-sm font-medium"
          >
            Back to providers
          </Link>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <LlmProviderForm
          provider={
            provider
              ? {
                  id: provider.id,
                  name: provider.name,
                  baseUrl: provider.baseUrl,
                  chatModel: provider.chatModel,
                  embeddingModel: provider.embeddingModel,
                  temperature: provider.temperature,
                  timeoutMs: provider.timeoutMs,
                  maxTokens: provider.maxTokens,
                  active: provider.active,
                  supportsJsonSchema: provider.supportsJsonSchema,
                  fallbackEnabled: provider.fallbackEnabled,
                  hasApiKey: Boolean(provider.credential),
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}
