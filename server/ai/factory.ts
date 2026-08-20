import { env } from "@/schemas/env";
import { OpenAICompatibleProvider } from "./openai-compatible";
import type { AIProviderConfiguration } from "./types";

export function aiProviderConfiguration(): AIProviderConfiguration {
  const configuration = env();
  return {
    provider: configuration.AI_PROVIDER,
    baseUrl: configuration.AI_BASE_URL,
    apiKey: configuration.AI_API_KEY,
    model: configuration.AI_MODEL,
    timeoutMs: configuration.AI_TIMEOUT_MS,
    inactivityTimeoutMs: configuration.AI_STREAM_INACTIVITY_TIMEOUT_MS,
    maxRetries: configuration.AI_MAX_RETRIES,
    temperature: configuration.AI_TEMPERATURE,
    supportsJsonSchema: configuration.AI_SUPPORTS_JSON_SCHEMA,
  };
}

export function createAIProvider(
  configuration: AIProviderConfiguration = aiProviderConfiguration(),
) {
  return new OpenAICompatibleProvider(configuration);
}
