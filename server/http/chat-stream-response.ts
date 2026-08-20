import type { AppResult } from "@/types/result";

type TokenEmitter = (token: string) => void | Promise<void>;

function eventPayload(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function chatStreamResponse<T>(
  operation: (emitToken: TokenEmitter) => Promise<AppResult<T>>,
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
          const result = await operation((token) => emit("token", token));
          if (result.ok) emit("result", result.data);
          else
            emit("error", {
              error: result.error.code,
              message: result.error.message,
            });
        } catch {
          emit("error", {
            error: "INTERNAL_ERROR",
            message: "The message could not be completed. Please try again.",
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
