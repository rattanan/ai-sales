const REDACT_KEYS =
  /password|secret|token|api.?key|credential|ciphertext|authorization|connection(string|url)?/i;

export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        REDACT_KEYS.test(key) ? "[REDACTED]" : redact(nested),
      ]),
    );
  }
  return value;
}

function write(
  level: "debug" | "info" | "warn" | "error",
  message: string,
  context?: unknown,
) {
  const entry = JSON.stringify({
    level,
    message,
    time: new Date().toISOString(),
    context: redact(context),
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export const logger = {
  debug: (message: string, context?: unknown) =>
    write("debug", message, context),
  info: (message: string, context?: unknown) => write("info", message, context),
  warn: (message: string, context?: unknown) => write("warn", message, context),
  error: (message: string, context?: unknown) =>
    write("error", message, context),
};
