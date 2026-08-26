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

/**
 * How long an organization's embedding provider stays circuit-broken after a
 * failure. Retrieval falls back to keyword search when embedding fails, but it
 * re-attempts on every call — and an agentic turn can search five times, so
 * one unreachable provider used to cost five full timeouts and blow the
 * turn's wall-clock budget. Short enough that a recovered provider is picked
 * up within a turn or two.
 */
const EMBEDDING_COOLDOWN_MS = 15_000;
const embeddingFailedAt = new Map<string, number>();

export class EmbeddingProviderCooldownError extends Error {
  constructor() {
    super("The embedding provider failed recently and is cooling down");
    this.name = "EmbeddingProviderCooldownError";
  }
}

export function resetEmbeddingCooldown(organizationId?: string) {
  if (organizationId) embeddingFailedAt.delete(organizationId);
  else embeddingFailedAt.clear();
}

export async function embedKnowledgeQuery(
  organizationId: string,
  input: string,
  providerId?: string | null,
) {
  const failedAt = embeddingFailedAt.get(organizationId);
  if (failedAt !== undefined) {
    if (Date.now() - failedAt < EMBEDDING_COOLDOWN_MS)
      throw new EmbeddingProviderCooldownError();
    embeddingFailedAt.delete(organizationId);
  }
  try {
    return await embedKnowledgeQueryUncached(
      organizationId,
      input,
      providerId,
    );
  } catch (error) {
    embeddingFailedAt.set(organizationId, Date.now());
    throw error;
  }
}

async function embedKnowledgeQueryUncached(
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
