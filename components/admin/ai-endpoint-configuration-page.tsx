import Link from "next/link";
import { notFound } from "next/navigation";
import { AiEndpointForm } from "@/components/admin/ai-endpoint-form";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export async function AiEndpointConfigurationPage({
  kind,
  endpointId,
}: {
  kind: "CHAT" | "EMBEDDING";
  endpointId?: string;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const endpoint = endpointId
    ? await db.aiEndpointConfig.findFirst({
        where: {
          id: endpointId,
          organizationId: context.organizationId,
          kind,
        },
        include: { credential: { select: { id: true } } },
      })
    : null;
  if (endpointId && !endpoint) notFound();

  const embedding = kind === "EMBEDDING";
  const basePath = embedding
    ? "/workspace/admin/embedding-endpoint"
    : "/workspace/admin/chat-endpoint";
  const endpointLabel = embedding ? "embedding endpoint" : "chat endpoint";

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={embedding ? "Embedding endpoint" : "Chat AI endpoint"}
        title={endpoint ? `Edit ${endpoint.name}` : `Add ${endpointLabel}`}
        description={
          endpoint
            ? "Update this endpoint configuration or test its current connection."
            : `Configure one ${endpointLabel} without mixing the form into the endpoint list.`
        }
        action={
          <Button asChild variant="outline">
            <Link href={basePath}>Back to endpoints</Link>
          </Button>
        }
      />
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <AiEndpointForm
          kind={kind}
          value={
            endpoint
              ? {
                  id: endpoint.id,
                  name: endpoint.name,
                  kind: endpoint.kind,
                  providerType: endpoint.providerType,
                  baseUrl: endpoint.baseUrl,
                  model: endpoint.model,
                  temperature: endpoint.temperature,
                  maxTokens: endpoint.maxTokens,
                  batchSize: endpoint.batchSize,
                  vectorDimension: endpoint.vectorDimension,
                  timeoutMs: endpoint.timeoutMs,
                  maxRetries: endpoint.maxRetries,
                  active: endpoint.active,
                  credentialPresent: Boolean(endpoint.credential),
                }
              : undefined
          }
        />
      </section>
    </div>
  );
}
