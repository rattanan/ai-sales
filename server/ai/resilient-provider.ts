import type {
  AIProvider,
  AIProviderHealth,
  AIRequest,
  AIResponse,
} from "./types";
import { failure, success, type AppResult } from "@/types/result";
import { logger } from "@/server/services/logger";

export class CircuitBreaker {
  private failures = 0;
  private openedAt?: number;

  constructor(
    private readonly failureThreshold: number,
    private readonly cooldownMs: number,
  ) {}

  canRequest(now = Date.now()) {
    if (this.openedAt === undefined) return true;
    if (now - this.openedAt < this.cooldownMs) return false;
    // Half-open: allow one probe. A subsequent failure opens it again.
    this.openedAt = undefined;
    this.failures = Math.max(0, this.failureThreshold - 1);
    return true;
  }

  recordSuccess() {
    this.failures = 0;
    this.openedAt = undefined;
  }

  recordFailure(now = Date.now()) {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) this.openedAt = now;
  }

  snapshot(now = Date.now()) {
    const open =
      this.openedAt !== undefined && now - this.openedAt < this.cooldownMs;
    return {
      state: open ? "OPEN" : this.failures ? "HALF_OPEN" : "CLOSED",
      failures: this.failures,
    } as const;
  }
}

const breakers = new Map<string, CircuitBreaker>();

function retryable(result: AppResult<unknown>) {
  return (
    !result.ok &&
    [
      "AI_PROVIDER_ERROR",
      "AI_RATE_LIMITED",
      "AI_TIMEOUT",
      "AI_INVALID_RESPONSE",
    ].includes(result.error.code)
  );
}

export class ResilientAIProvider implements AIProvider {
  readonly name: string;
  readonly model: string;
  readonly capabilities;
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly primary: AIProvider,
    private readonly fallback: AIProvider | undefined,
    options: {
      key: string;
      failureThreshold: number;
      cooldownMs: number;
    },
  ) {
    this.name = fallback
      ? `resilient:${primary.name}:${fallback.name}`
      : primary.name;
    this.model = fallback
      ? `${primary.model}|fallback:${fallback.model}`
      : primary.model;
    this.capabilities = primary.capabilities;
    this.breaker =
      breakers.get(options.key) ??
      new CircuitBreaker(options.failureThreshold, options.cooldownMs);
    breakers.set(options.key, this.breaker);
  }

  private normalize<T>(result: AppResult<AIResponse<T>>) {
    if (!result.ok) return result;
    return success({ ...result.data, provider: this.name, model: this.model });
  }

  async generateStructuredOutput<T>(request: AIRequest<T>) {
    if (this.breaker.canRequest()) {
      const primary = await this.primary.generateStructuredOutput(request);
      if (primary.ok) {
        this.breaker.recordSuccess();
        return this.normalize(primary);
      }
      if (!retryable(primary)) return primary;
      this.breaker.recordFailure();
      logger.warn("Primary AI provider failed; evaluating governed fallback", {
        requestId: request.requestId,
        provider: this.primary.name,
        model: this.primary.model,
        errorCode: primary.error.code,
        circuit: this.breaker.snapshot().state,
      });
    }
    if (!this.fallback)
      return failure(
        "AI_PROVIDER_ERROR",
        "The AI provider circuit is open and no fallback is configured.",
        {
          requestId: request.requestId,
          diagnostics: { circuitOpen: true },
        },
      );
    const fallback = await this.fallback.generateStructuredOutput(request);
    if (fallback.ok)
      logger.warn("AI request completed through configured fallback", {
        requestId: request.requestId,
        provider: this.fallback.name,
        model: this.fallback.model,
      });
    return this.normalize(fallback);
  }

  async healthCheck(
    requestId = crypto.randomUUID(),
  ): Promise<AppResult<AIProviderHealth>> {
    if (this.breaker.canRequest()) {
      const primary = await this.primary.healthCheck(requestId);
      if (primary.ok) {
        this.breaker.recordSuccess();
        return success({
          ...primary.data,
          provider: this.name,
          model: this.model,
        });
      }
      this.breaker.recordFailure();
    }
    if (!this.fallback)
      return failure(
        "AI_PROVIDER_ERROR",
        "No healthy AI provider is available.",
        {
          requestId,
          diagnostics: { circuitOpen: true },
        },
      );
    const fallback = await this.fallback.healthCheck(requestId);
    return fallback.ok
      ? success({ ...fallback.data, provider: this.name, model: this.model })
      : fallback;
  }
}

export function resetCircuitBreakersForTests() {
  breakers.clear();
}
