import type { z } from "zod";
import type { AppResult } from "@/types/result";

export type AIProviderHealth = {
  available: true;
  provider: string;
  model: string;
  latencyMs: number;
};

export type AIModelCapabilities = {
  structuredOutput: "json-schema" | "json-object";
  capturesTokenUsage: boolean;
};

export type AIRequest<T> = {
  requestId: string;
  schemaName: string;
  outputSchema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  promptVersion: string;
  timeoutMs?: number;
  onProgress?: (progress: AIStreamProgress) => void | Promise<void>;
};

export type AIStreamProgress = {
  elapsedMs: number;
  chunkCount: number;
  receivedBytes: number;
  receivedFirstChunk: boolean;
};

export type AIResponse<T> = {
  data: T;
  provider: string;
  model: string;
  requestId: string;
  promptVersion: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export interface AIProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities: AIModelCapabilities;
  generateStructuredOutput<T>(
    request: AIRequest<T>,
  ): Promise<AppResult<AIResponse<T>>>;
  healthCheck(requestId?: string): Promise<AppResult<AIProviderHealth>>;
}

export type AIProviderConfiguration = {
  provider: "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model?: string;
  timeoutMs: number;
  inactivityTimeoutMs: number;
  maxRetries: number;
  temperature: number;
  supportsJsonSchema: boolean;
};
