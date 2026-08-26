import type { AppResult } from "@/types/result";
import { logger } from "@/server/services/logger";

type TokenEmitter = (token: string) => void | Promise<void>;

function eventPayload(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function safeErrorDiagnostics(error: unknown) {
  if (!(error instanceof Error)) return { errorType: typeof error };
  const code =
    "code" in error &&
    (typeof error.code === "string" || typeof error.code === "number")
      ? String(error.code)
      : undefined;
  return {
    errorType: error.name,
    errorCode: code,
    stackFrames: error.stack?.split("\n").slice(1, 8).join("\n"),
  };
}

export type ChatStreamEventEmitter = (event: unknown) => void;

export function chatStreamResponse<T>(
  operation: (
    emitToken: TokenEmitter,
    emitStepEvent: ChatStreamEventEmitter,
  ) => Promise<AppResult<T>>,
) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const emit = (event: string, data: unknown) => {
        if (cancelled) return;
        try {
          controller.enqueue(encoder.encode(eventPayload(event, data)));
        } catch {
          cancelled = true;
        }
      };

      void (async () => {
        emit("status", { phase: "retrieving" });
        try {
          const result = await operation(
            (token) => emit("token", token),
            (event) => emit("step", event),
          );
          if (result.ok) emit("result", result.data);
          else
            emit("error", {
              error: result.error.code,
              message: result.error.message,
            });
        } catch (error) {
          const requestId = crypto.randomUUID();
          logger.error("Chat stream operation failed", {
            requestId,
            ...safeErrorDiagnostics(error),
          });
          emit("error", {
            error: "INTERNAL_ERROR",
            message: "The message could not be completed. Please try again.",
            requestId,
          });
        } finally {
          if (!cancelled) {
            try {
              controller.close();
            } catch {
              // The browser may have closed the stream while persistence was
              // finishing. The completed chat turn remains authoritative.
            }
          }
        }
      })();
    },
    cancel() {
      cancelled = true;
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
