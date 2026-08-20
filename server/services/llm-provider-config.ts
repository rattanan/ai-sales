import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { createAIProvider } from "@/server/ai/factory";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import { ResilientAIProvider } from "@/server/ai/resilient-provider";
import {
  activeAiEndpoint,
  getAiEndpointSecret,
} from "@/server/services/ai-endpoint-service";

export function llmProviderEncryption() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

export async function getProviderSecret(providerId: string) {
  const credential = await db.llmProviderCredential.findUnique({
    where: { providerId },
    select: {
      ciphertext: true,
      iv: true,
      authTag: true,
      keyVersion: true,
    },
  });
  return credential ? llmProviderEncryption().decrypt(credential) : undefined;
}

export async function createOrganizationAIProvider(organizationId: string) {
  const [chatEndpoint, primary, fallback] = await Promise.all([
    activeAiEndpoint(organizationId, "CHAT"),
    db.llmProvider.findFirst({
      where: { organizationId, active: true },
      include: { credential: true },
      orderBy: { updatedAt: "desc" },
    }),
    db.llmProvider.findFirst({
      where: { organizationId, fallbackEnabled: true },
      include: { credential: true },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  if (chatEndpoint) {
    const configuration = env();
    return new ResilientAIProvider(
      createAIProvider({
        provider: "openai-compatible",
        baseUrl: chatEndpoint.baseUrl.replace(/\/chat\/completions\/?$/, ""),
        apiKey: await getAiEndpointSecret(chatEndpoint.id),
        model: chatEndpoint.model,
        timeoutMs: chatEndpoint.timeoutMs,
        inactivityTimeoutMs: chatEndpoint.timeoutMs,
        maxRetries: chatEndpoint.maxRetries,
        temperature: chatEndpoint.temperature ?? 0.1,
        supportsJsonSchema: true,
      }),
      undefined,
      {
        key: `${organizationId}:chat-endpoint:${chatEndpoint.id}`,
        failureThreshold: configuration.AI_CIRCUIT_FAILURE_THRESHOLD,
        cooldownMs: configuration.AI_CIRCUIT_COOLDOWN_MS,
      },
    );
  }
  if (!primary) return createAIProvider();
  const configuration = env();
  const build = (provider: NonNullable<typeof primary>) =>
    createAIProvider({
      provider: "openai-compatible",
      baseUrl: provider.baseUrl,
      apiKey: provider.credential
        ? llmProviderEncryption().decrypt(provider.credential)
        : undefined,
      model: provider.chatModel,
      timeoutMs: provider.timeoutMs,
      inactivityTimeoutMs: provider.timeoutMs,
      maxRetries: configuration.AI_MAX_RETRIES,
      temperature: provider.temperature,
      supportsJsonSchema: provider.supportsJsonSchema,
    });
  const fallbackProvider =
    fallback && fallback.id !== primary.id ? fallback : undefined;
  return new ResilientAIProvider(
    build(primary),
    fallbackProvider ? build(fallbackProvider) : undefined,
    {
      key: `${organizationId}:${primary.id}`,
      failureThreshold: configuration.AI_CIRCUIT_FAILURE_THRESHOLD,
      cooldownMs: configuration.AI_CIRCUIT_COOLDOWN_MS,
    },
  );
}

export async function testLlmProvider(
  providerId: string,
  organizationId: string,
) {
  const provider = await db.llmProvider.findFirst({
    where: { id: providerId, organizationId },
    include: { credential: true },
  });
  if (!provider) throw new Error("PROVIDER_NOT_FOUND");
  const apiKey = provider.credential
    ? llmProviderEncryption().decrypt(provider.credential)
    : undefined;
  const ai = createAIProvider({
    provider: "openai-compatible",
    baseUrl: provider.baseUrl,
    apiKey,
    model: provider.chatModel,
    timeoutMs: provider.timeoutMs,
    inactivityTimeoutMs: provider.timeoutMs,
    maxRetries: 0,
    temperature: provider.temperature,
    supportsJsonSchema: provider.supportsJsonSchema,
  });
  const chat = await ai.healthCheck();
  const embeddingStartedAt = performance.now();
  let embedding:
    { ok: true; latencyMs: number } | { ok: false; message: string };
  try {
    const response = await fetch(
      `${provider.baseUrl.replace(/\/$/, "")}/embeddings`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: provider.embeddingModel,
          input: "InsightKM health check",
        }),
        signal: AbortSignal.timeout(Math.min(provider.timeoutMs, 10_000)),
      },
    );
    embedding = response.ok
      ? {
          ok: true,
          latencyMs: Math.round(performance.now() - embeddingStartedAt),
        }
      : {
          ok: false,
          message: `Embedding endpoint returned ${response.status}`,
        };
  } catch (error) {
    embedding = {
      ok: false,
      message:
        error instanceof Error && error.name === "TimeoutError"
          ? "Embedding endpoint timed out"
          : "Embedding endpoint is not reachable",
    };
  }
  const healthy = chat.ok && embedding.ok;
  const message = healthy
    ? "Chat and embedding models are reachable."
    : [
        chat.ok ? null : chat.error.message,
        embedding.ok ? null : embedding.message,
      ]
        .filter(Boolean)
        .join(" ");
  await db.llmProvider.update({
    where: { id: provider.id },
    data: {
      lastHealthStatus: healthy ? "HEALTHY" : "UNHEALTHY",
      lastChatHealthStatus: chat.ok ? "HEALTHY" : "UNHEALTHY",
      lastEmbeddingHealthStatus: embedding.ok ? "HEALTHY" : "UNHEALTHY",
      lastHealthMessage: message.slice(0, 500),
      lastChatLatencyMs: chat.ok ? chat.data.latencyMs : null,
      lastEmbeddingLatencyMs: embedding.ok ? embedding.latencyMs : null,
      lastTestedAt: new Date(),
    },
  });
  return { healthy, message };
}
