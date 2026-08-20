type ChatAnswer = {
  content: string;
  inputTokens?: number;
  outputTokens?: number;
};

type TokenEmitter = (token: string) => void | Promise<void>;

export async function readChatCompletionResponse(
  response: Response,
  onToken?: TokenEmitter,
): Promise<ChatAnswer> {
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    if (!response.body)
      throw new Error("Chat provider returned an empty answer stream");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    const consumeEvent = async (event: string) => {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") return;
      const payload = JSON.parse(data) as {
        choices?: Array<{ delta?: { content?: string } }>;
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
        };
      };
      const token = payload.choices?.[0]?.delta?.content;
      if (token) {
        content += token;
        await onToken?.(token);
      }
      if (payload.usage) {
        inputTokens = payload.usage.prompt_tokens;
        outputTokens = payload.usage.completion_tokens;
      }
    };

    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        buffer += decoder
          .decode(next.value, { stream: true })
          .replace(/\r\n/g, "\n");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0) {
          await consumeEvent(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
      buffer += decoder.decode();
      if (buffer.trim()) await consumeEvent(buffer.trim());
    } finally {
      reader.releaseLock();
    }
    const answer = content.trim();
    if (!answer) throw new Error("Chat provider returned an empty answer");
    return { content: answer, inputTokens, outputTokens };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
    };
  };
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error("Chat provider returned an empty answer");
  await onToken?.(content);
  return {
    content,
    inputTokens: payload.usage?.prompt_tokens,
    outputTokens: payload.usage?.completion_tokens,
  };
}
