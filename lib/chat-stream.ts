import { readJsonResponse } from "@/lib/http-response";

type ChatStreamCallbacks = {
  onToken: (token: string) => void;
  onStatus?: (phase: string) => void;
};

function eventValue(block: string, field: string) {
  return block
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${field}:`))
    ?.slice(field.length + 1)
    .trimStart();
}

export async function readChatStream<T>(
  response: Response,
  callbacks: ChatStreamCallbacks,
) {
  if (!response.ok) {
    const payload = await readJsonResponse<{ message?: string }>(
      response,
      "The message could not be completed. Please try again.",
    );
    throw new Error(payload.message ?? "The message could not be completed.");
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("text/event-stream")
  )
    throw new Error("The server returned an invalid chat stream.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: T | undefined;

  const consume = (block: string) => {
    const event = eventValue(block, "event");
    const data = eventValue(block, "data");
    if (!event || !data) return;
    const payload = JSON.parse(data) as unknown;
    if (event === "token" && typeof payload === "string") {
      callbacks.onToken(payload);
      return;
    }
    if (
      event === "status" &&
      payload &&
      typeof payload === "object" &&
      "phase" in payload &&
      typeof payload.phase === "string"
    ) {
      callbacks.onStatus?.(payload.phase);
      return;
    }
    if (event === "result") {
      result = payload as T;
      return;
    }
    if (event === "error") {
      const message =
        payload &&
        typeof payload === "object" &&
        "message" in payload &&
        typeof payload.message === "string"
          ? payload.message
          : "The message could not be completed.";
      throw new Error(message);
    }
  };

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder
      .decode(next.value, { stream: true })
      .replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      boundary = buffer.indexOf("\n\n");
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) consume(buffer.trim());
  if (!result) throw new Error("The chat stream ended before it completed.");
  return result;
}
