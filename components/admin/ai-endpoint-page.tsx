import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export async function AiEndpointPage({ kind }: { kind: "CHAT" | "EMBEDDING" }) {
  const context = await requireAuthorization();
  await requirePermission(context, "provider.manage");
  const endpoints = await db.aiEndpointConfig.findMany({
    where: { organizationId: context.organizationId, kind },
    include: { credential: { select: { id: true } } },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
  const embedding = kind === "EMBEDDING";
  const basePath = embedding
    ? "/workspace/admin/embedding-endpoint"
    : "/workspace/admin/chat-endpoint";
  return (
    <div className="space-y-6">
      <PageHeader
        title={embedding ? "Embedding endpoint" : "Chat AI endpoint"}
        description={
          embedding
            ? "Dedicated document, query, metadata, and topic-clustering embeddings. Changing the model contract marks existing sources for re-indexing."
            : "Dedicated completion endpoint for chat, tool selection, SQL generation, summarization, and business insight."
        }
        action={
          <Button asChild>
            <Link href={`${basePath}/new`}>
              Add {embedding ? "embedding" : "chat"} endpoint
            </Link>
          </Button>
        }
      />
      <section className="grid gap-4 xl:grid-cols-2" aria-label="AI endpoints">
        {endpoints.map((endpoint) => (
          <article key={endpoint.id} className="rounded-xl border bg-card p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{endpoint.name}</h2>
                  <Badge tone={endpoint.active ? "success" : "neutral"}>
                    {endpoint.active ? "ACTIVE" : "INACTIVE"}
                  </Badge>
                  <Badge
                    tone={
                      endpoint.lastHealthStatus === "HEALTHY"
                        ? "success"
                        : endpoint.lastHealthStatus === "UNHEALTHY"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {endpoint.lastHealthStatus}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {endpoint.providerType.replaceAll("_", " ")} ·{" "}
                  {endpoint.model}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Secret:{" "}
                {endpoint.credential ? "•••••••• configured" : "not configured"}
              </p>
            </div>
            {endpoint.lastHealthMessage ? (
              <p className="rounded-lg bg-muted p-3 text-sm">
                {endpoint.lastHealthMessage}
                {endpoint.lastLatencyMs
                  ? ` · ${endpoint.lastLatencyMs} ms`
                  : ""}
                {endpoint.lastDetectedDimension
                  ? ` · ${endpoint.lastDetectedDimension} dimensions`
                  : ""}
              </p>
            ) : null}
            <div className="mt-5 border-t pt-4">
              <Button asChild>
                <Link href={`${basePath}/${endpoint.id}/edit`}>
                  Edit endpoint
                </Link>
              </Button>
            </div>
          </article>
        ))}
        {!endpoints.length ? (
          <div className="rounded-xl border border-dashed p-10 text-center xl:col-span-2">
            <p className="font-medium">
              No {embedding ? "embedding" : "chat"} endpoints configured yet.
            </p>
            <Button asChild className="mt-4">
              <Link href={`${basePath}/new`}>Add the first endpoint</Link>
            </Button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
