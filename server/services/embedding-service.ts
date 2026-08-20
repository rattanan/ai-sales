import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { getProviderSecret } from "@/server/services/llm-provider-config";
import {
  activeAiEndpoint,
  getAiEndpointSecret,
  resolvedAiEndpointUrl,
} from "@/server/services/ai-endpoint-service";
import {
  assertEmbeddingCount,
  embeddingAdapter,
  inferEmbeddingProviderType,
} from "@/packages/ai/embedding-adapter";
import { fetchAiWithRetry } from "@/packages/ai/fetch-with-retry";
import { providerHttpError } from "@/packages/ai/provider-http-error";

export async function embedKnowledgeQuery(
  organizationId: string,
  input: string,
  providerId?: string | null,
) {
  const endpoint = await activeAiEndpoint(organizationId, "EMBEDDING");
  const provider = providerId
    ? await db.llmProvider.findFirst({
        where: { id: providerId, organizationId },
      })
    : await db.llmProvider.findFirst({
        where: { organizationId, active: true },
        orderBy: { updatedAt: "desc" },
      });
  const configuration = env();
  const url = endpoint
    ? resolvedAiEndpointUrl(endpoint)
    : provider
      ? `${provider.baseUrl.replace(/\/$/, "")}/embeddings`
      : configuration.EMBEDDING_BASE_URL;
  const model =
    endpoint?.model ??
    provider?.embeddingModel ??
    configuration.EMBEDDING_MODEL;
  const apiKey = endpoint
    ? await getAiEndpointSecret(endpoint.id)
    : provider
      ? await getProviderSecret(provider.id)
      : undefined;
  const providerType = inferEmbeddingProviderType(endpoint?.providerType, url);
  const adapter = embeddingAdapter(providerType);
  const response = await fetchAiWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify(adapter.request(model, input)),
    },
    {
      timeoutMs: endpoint?.timeoutMs ?? configuration.EMBEDDING_TIMEOUT_MS,
      maxRetries: endpoint?.maxRetries ?? configuration.AI_MAX_RETRIES,
    },
  );
  if (!response.ok) throw new Error(await providerHttpError(response));
  const embedding = assertEmbeddingCount(
    adapter.vectors(await response.json()),
    1,
  )[0];
  return { embedding, model };
}
