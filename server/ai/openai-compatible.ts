import { z } from "zod";
import { logger } from "@/server/services/logger";
import { failure, success } from "@/types/result";
import type {
  AIProvider,
  AIProviderConfiguration,
  AIRequest,
  AIResponse,
  AIStreamProgress,
} from "./types";

const completionEnvelopeSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({ content: z.string() }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

const streamChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({ content: z.string().optional() })
          .passthrough()
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({
      prompt_tokens: z.number().int().nonnegative().optional(),
      completion_tokens: z.number().int().nonnegative().optional(),
      total_tokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
});

type ProviderUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

type StreamState = AIStreamProgress & {
  output: string;
  usage?: ProviderUsage;
  completed: boolean;
};

function sleep(delayMs: number) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function providerUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

type ProviderErrorDiagnostic = {
  providerErrorCode?: string | number;
  providerErrorStatus?: string;
  schemaRejected?: boolean;
};

async function providerErrorDiagnostic(response: Response) {
  try {
    const payload: unknown = await response.clone().json();
    const error = Array.isArray(payload)
      ? payload[0]?.error
      : payload && typeof payload === "object" && "error" in payload
        ? payload.error
        : undefined;
    if (!error || typeof error !== "object") return {};
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : "";
    return {
      ...(typeof record.code === "string" || typeof record.code === "number"
        ? { providerErrorCode: record.code }
        : {}),
      ...(typeof record.status === "string"
        ? { providerErrorStatus: record.status }
        : {}),
      ...(message.toLowerCase().includes("schema")
        ? { schemaRejected: true }
        : {}),
    } satisfies ProviderErrorDiagnostic;
  } catch {
    return {};
  }
}

function providerFailure(
  status: number,
  requestId: string,
  diagnostic: ProviderErrorDiagnostic = {},
) {
  if (status === 429)
    return failure(
      "AI_RATE_LIMITED",
      "The AI provider is temporarily rate limited. Try again shortly.",
      { requestId, diagnostics: { providerStatus: status, ...diagnostic } },
    );
  if (diagnostic.schemaRejected)
    return failure(
      "AI_PROVIDER_ERROR",
      "The AI provider rejected the required JSON Schema. Set AI_SUPPORTS_JSON_SCHEMA=false and restart the app.",
      { requestId, diagnostics: { providerStatus: status, ...diagnostic } },
    );
  return failure(
    "AI_PROVIDER_ERROR",
    "The AI provider could not complete the structured request.",
    { requestId, diagnostics: { providerStatus: status, ...diagnostic } },
  );
}

function usageFrom(value: {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
}): ProviderUsage {
  return {
    inputTokens: value.prompt_tokens,
    outputTokens: value.completion_tokens,
    totalTokens: value.total_tokens,
  };
}

function eventData(event: string) {
  const values = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  return values.length ? values.join("\n") : null;
}

function parseStructuredJson(output: string): unknown | null {
  const candidates = [output.trim()];
  const fenced = output.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue to extract the first complete JSON object from a provider
      // response that incorrectly includes prose or Markdown around it.
    }
  }
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < output.length; index++) {
    const character = output[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{" && start < 0) {
      start = index;
      depth = 1;
      continue;
    }
    if (start < 0) continue;
    if (character === "{") depth += 1;
    if (character === "}") depth -= 1;
    if (depth !== 0) continue;
    try {
      return JSON.parse(output.slice(start, index + 1));
    } catch {
      start = -1;
    }
  }
  return null;
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  return new Promise<ReadableStreamReadResult<Uint8Array>>(
    (resolve, reject) => {
      const onAbort = () => reject(new DOMException("aborted", "AbortError"));
      signal.addEventListener("abort", onAbort, { once: true });
      void reader.read().then(
        (result) => {
          signal.removeEventListener("abort", onAbort);
          resolve(result);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", onAbort);
          reject(error);
        },
      );
    },
  );
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name = "openai-compatible";
  readonly capabilities;

  constructor(private readonly configuration: AIProviderConfiguration) {
    this.capabilities = {
      structuredOutput: configuration.supportsJsonSchema
        ? ("json-schema" as const)
        : ("json-object" as const),
      capturesTokenUsage: true,
    };
  }

  get model() {
    return this.configuration.model ?? "";
  }

  private headers(requestId: string) {
    return {
      "content-type": "application/json",
      "x-request-id": requestId,
      ...(this.configuration.apiKey
        ? { authorization: `Bearer ${this.configuration.apiKey}` }
        : {}),
    };
  }

  async healthCheck(requestId = crypto.randomUUID()) {
    if (!this.configuration.model)
      return failure(
        "AI_CONFIGURATION_ERROR",
        "Configure AI_MODEL before starting analysis.",
        { requestId },
      );
    const startedAt = performance.now();
    try {
      const response = await fetch(
        providerUrl(this.configuration.baseUrl, "/models"),
        {
          headers: this.headers(requestId),
          signal: AbortSignal.timeout(
            Math.min(this.configuration.timeoutMs, 10_000),
          ),
        },
      );
      if (!response.ok) return providerFailure(response.status, requestId);
      return success({
        available: true as const,
        provider: this.name,
        model: this.configuration.model,
        latencyMs: Math.round(performance.now() - startedAt),
      });
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "TimeoutError";
      logger.warn("AI provider health check failed", {
        requestId,
        provider: this.name,
        model: this.configuration.model,
        timedOut,
      });
      return failure(
        timedOut ? "AI_TIMEOUT" : "AI_PROVIDER_ERROR",
        timedOut
          ? "The AI provider health check timed out."
          : "The AI provider is not reachable.",
        { requestId },
      );
    }
  }

  private async reportProgress<T>(
    request: AIRequest<T>,
    startedAt: number,
    state: StreamState,
  ) {
    await request.onProgress?.({
      elapsedMs: Math.round(performance.now() - startedAt),
      chunkCount: state.chunkCount,
      receivedBytes: state.receivedBytes,
      receivedFirstChunk: state.receivedFirstChunk,
    });
  }

  private async consumeStream<T>(
    response: Response,
    request: AIRequest<T>,
    startedAt: number,
    state: StreamState,
    resetInactivityTimeout: () => void,
    signal: AbortSignal,
  ) {
    if (!response.body)
      return failure(
        "AI_INVALID_RESPONSE",
        "The AI provider returned an empty streaming response.",
        { requestId: request.requestId },
      );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const next = await readStreamChunk(reader, signal);
        if (next.done) break;
        resetInactivityTimeout();
        state.receivedBytes += next.value.byteLength;
        buffer += decoder
          .decode(next.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          const data = eventData(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
          if (!data) continue;
          if (data === "[DONE]") {
            state.completed = true;
            continue;
          }
          let parsedChunk: unknown;
          try {
            parsedChunk = JSON.parse(data);
          } catch {
            return failure(
              "AI_INVALID_RESPONSE",
              "The AI provider returned an invalid streaming event.",
              { requestId: request.requestId },
            );
          }
          const chunk = streamChunkSchema.safeParse(parsedChunk);
          if (!chunk.success)
            return failure(
              "AI_INVALID_RESPONSE",
              "The AI provider returned an invalid streaming event.",
              { requestId: request.requestId },
            );
          state.chunkCount += 1;
          state.receivedFirstChunk = true;
          state.output += chunk.data.choices?.[0]?.delta?.content ?? "";
          if (chunk.data.usage) state.usage = usageFrom(chunk.data.usage);
          await this.reportProgress(request, startedAt, state);
        }
      }
      const trailing = eventData(buffer.trim());
      if (trailing === "[DONE]") {
        state.completed = true;
      } else if (trailing) {
        try {
          const chunk = streamChunkSchema.parse(JSON.parse(trailing));
          state.chunkCount += 1;
          state.receivedFirstChunk = true;
          state.output += chunk.choices?.[0]?.delta?.content ?? "";
          if (chunk.usage) state.usage = usageFrom(chunk.usage);
          await this.reportProgress(request, startedAt, state);
        } catch {
          return failure(
            "AI_INVALID_RESPONSE",
            "The AI provider returned an invalid streaming event.",
            { requestId: request.requestId },
          );
        }
      }
      if (!state.receivedFirstChunk)
        return failure(
          "AI_INVALID_RESPONSE",
          "The AI provider ended the stream before completing a response.",
          { requestId: request.requestId },
        );
      // Gemini's OpenAI-compatible stream occasionally closes after emitting
      // the complete JSON but without a final [DONE] event. The JSON and Zod
      // validation that follows remain authoritative, so do not discard a
      // completed payload solely because that terminal event is missing.
      if (!state.completed)
        logger.warn("AI stream ended without a [DONE] event", {
          requestId: request.requestId,
          provider: this.name,
          model: this.model,
          chunkCount: state.chunkCount,
        });
      return success({ output: state.output, usage: state.usage });
    } finally {
      if (signal.aborted) await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }

  async generateStructuredOutput<T>(
    request: AIRequest<T>,
  ): Promise<
    ReturnType<typeof success<AIResponse<T>>> | ReturnType<typeof failure>
  > {
    if (!this.configuration.model)
      return failure(
        "AI_CONFIGURATION_ERROR",
        "Configure AI_MODEL before starting analysis.",
        { requestId: request.requestId },
      );

    const responseFormat = this.configuration.supportsJsonSchema
      ? {
          type: "json_schema",
          json_schema: {
            name: request.schemaName,
            strict: true,
            schema: z.toJSONSchema(request.outputSchema, {
              target: "draft-7",
            }),
          },
        }
      : { type: "json_object" };
    const outputContract = this.configuration.supportsJsonSchema
      ? undefined
      : JSON.stringify(
          z.toJSONSchema(request.outputSchema, { target: "draft-7" }),
        );
    const body = {
      model: this.configuration.model,
      temperature: this.configuration.temperature,
      stream: true,
      messages: [
        {
          role: "system",
          content: outputContract
            ? `${request.systemPrompt}\n\nReturn exactly one JSON object with no Markdown, explanation, or additional keys. It must satisfy this JSON Schema:\n${outputContract}`
            : request.systemPrompt,
        },
        { role: "user", content: request.userPrompt },
      ],
      response_format: responseFormat,
    };
    let repairAttempts = 0;
    // Some OpenAI-compatible providers (including Gemini's compatibility
    // endpoint) can accept a schema but still return enum/shape drift. Give
    // the model two explicit repair turns regardless of its advertised mode.
    const maxRepairAttempts = 2;
    const maximumAttempts = this.configuration.maxRetries + maxRepairAttempts;

    for (let attempt = 0; attempt <= maximumAttempts; attempt++) {
      const startedAt = performance.now();
      const controller = new AbortController();
      const absoluteTimeoutMs = Math.min(
        this.configuration.timeoutMs,
        request.timeoutMs ?? this.configuration.timeoutMs,
      );
      let timeoutKind: "absolute" | "inactivity" | undefined;
      const absoluteTimer = setTimeout(() => {
        timeoutKind = "absolute";
        controller.abort();
      }, absoluteTimeoutMs);
      let inactivityTimer: ReturnType<typeof setTimeout> | undefined;
      const resetInactivityTimeout = () => {
        if (inactivityTimer) clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => {
          timeoutKind = "inactivity";
          controller.abort();
        }, this.configuration.inactivityTimeoutMs);
      };
      resetInactivityTimeout();
      const state: StreamState = {
        output: "",
        elapsedMs: 0,
        chunkCount: 0,
        receivedBytes: 0,
        receivedFirstChunk: false,
        completed: false,
      };
      try {
        const response = await fetch(
          providerUrl(this.configuration.baseUrl, "/chat/completions"),
          {
            method: "POST",
            headers: this.headers(request.requestId),
            body: JSON.stringify(body),
            signal: controller.signal,
          },
        );
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        if (!response.ok) {
          if (retryable && attempt < this.configuration.maxRetries) {
            await sleep(250 * 2 ** attempt);
            continue;
          }
          logger.warn("AI structured request rejected", {
            requestId: request.requestId,
            provider: this.name,
            model: this.model,
            providerStatus: response.status,
            elapsedMs: Math.round(performance.now() - startedAt),
            attempt,
          });
          const diagnostic = await providerErrorDiagnostic(response);
          logger.warn("AI provider returned a structured request error", {
            requestId: request.requestId,
            provider: this.name,
            model: this.model,
            providerStatus: response.status,
            ...diagnostic,
          });
          return providerFailure(
            response.status,
            request.requestId,
            diagnostic,
          );
        }

        let rawOutput: string;
        let usage: ProviderUsage | undefined;
        if (
          response.headers.get("content-type")?.includes("text/event-stream")
        ) {
          const streamed = await this.consumeStream(
            response,
            request,
            startedAt,
            state,
            resetInactivityTimeout,
            controller.signal,
          );
          if (!streamed.ok) return streamed;
          rawOutput = streamed.data.output;
          usage = streamed.data.usage;
        } else {
          logger.warn("AI provider ignored streaming request", {
            requestId: request.requestId,
            provider: this.name,
            model: this.model,
            elapsedMs: Math.round(performance.now() - startedAt),
          });
          const envelope = completionEnvelopeSchema.safeParse(
            await response.json(),
          );
          if (!envelope.success)
            return failure(
              "AI_INVALID_RESPONSE",
              "The AI provider returned an invalid response envelope.",
              { requestId: request.requestId },
            );
          rawOutput = envelope.data.choices[0].message.content;
          usage = envelope.data.usage
            ? usageFrom(envelope.data.usage)
            : undefined;
        }
        const parsedOutput = parseStructuredJson(rawOutput);
        if (parsedOutput === null)
          return failure(
            "AI_INVALID_RESPONSE",
            "The AI provider did not return valid structured JSON.",
            { requestId: request.requestId },
          );
        const output = request.outputSchema.safeParse(parsedOutput);
        if (!output.success) {
          const validationPaths = output.error.issues
            .slice(0, 10)
            .map((issue) => issue.path.join("."));
          const repairIssues = output.error.issues
            .slice(0, 20)
            .map(
              (issue) =>
                `${issue.path.length ? issue.path.join(".") : "$"}: ${issue.code}`,
            )
            .join("\n");
          logger.warn("AI structured output validation failed", {
            requestId: request.requestId,
            provider: this.name,
            model: this.model,
            validationIssues: output.error.issues.length,
            validationPaths,
          });
          if (repairAttempts < maxRepairAttempts) {
            repairAttempts += 1;
            body.messages = [
              ...body.messages,
              { role: "assistant", content: rawOutput },
              {
                role: "user",
                content: `Your previous JSON did not satisfy the required schema. Correct every issue below and return the complete corrected JSON object only. Do not omit required fields, add unknown fields, or use Markdown.\n\nValidation issues:\n${repairIssues}`,
              },
            ];
            logger.info("Retrying AI output with schema repair feedback", {
              requestId: request.requestId,
              provider: this.name,
              model: this.model,
              validationIssues: output.error.issues.length,
              repairAttempt: repairAttempts,
            });
            continue;
          }
          return failure(
            "AI_INVALID_RESPONSE",
            "The AI provider returned JSON that does not match the required dashboard structure. Retry the stage or use a provider with stronger structured-output support.",
            {
              requestId: request.requestId,
              diagnostics: {
                validationIssues: output.error.issues.length,
                validationPathCount: validationPaths.length,
                validationPaths: validationPaths.join(","),
              },
            },
          );
        }
        return success({
          data: output.data,
          provider: this.name,
          model: this.model,
          requestId: request.requestId,
          promptVersion: request.promptVersion,
          usage,
        });
      } catch {
        const timedOut = timeoutKind !== undefined;
        if (!timedOut && attempt < this.configuration.maxRetries) {
          await sleep(250 * 2 ** attempt);
          continue;
        }
        const elapsedMs = Math.round(performance.now() - startedAt);
        logger.warn("AI structured streaming request failed", {
          requestId: request.requestId,
          provider: this.name,
          model: this.model,
          timedOut,
          timeoutKind,
          elapsedMs,
          chunkCount: state.chunkCount,
          receivedBytes: state.receivedBytes,
          attempt,
        });
        if (timedOut) {
          const message = !state.receivedFirstChunk
            ? "The AI provider did not begin responding before the timeout."
            : timeoutKind === "inactivity"
              ? "The AI provider response stream stalled."
              : "The AI provider response exceeded the maximum wait time.";
          return failure("AI_TIMEOUT", message, {
            requestId: request.requestId,
            diagnostics: {
              timeoutKind: timeoutKind ?? null,
              elapsedMs,
              chunkCount: state.chunkCount,
            },
          });
        }
        return failure(
          "AI_PROVIDER_ERROR",
          "The AI provider could not be reached.",
          { requestId: request.requestId },
        );
      } finally {
        clearTimeout(absoluteTimer);
        if (inactivityTimer) clearTimeout(inactivityTimer);
      }
    }
    return failure(
      "AI_PROVIDER_ERROR",
      "The AI provider could not complete the request.",
      { requestId: request.requestId },
    );
  }
}
