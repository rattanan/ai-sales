export type AppErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "CONNECTION_FAILED"
  | "CONNECTOR_NOT_IMPLEMENTED"
  | "UNSAFE_QUERY"
  | "AI_CONFIGURATION_ERROR"
  | "AI_PROVIDER_ERROR"
  | "AI_RATE_LIMITED"
  | "AI_TIMEOUT"
  | "AI_INVALID_RESPONSE"
  | "ANALYSIS_SCOPE_INVALID"
  | "QUERY_VALIDATION_FAILED"
  | "QUERY_EXECUTION_FAILED"
  | "FILE_INVALID"
  | "INTERNAL_ERROR";

export type AppError = {
  code: AppErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: Record<string, string[]>;
  diagnostics?: Record<string, string | number | boolean | null>;
};

export type AppResult<T> =
  { ok: true; data: T } | { ok: false; error: AppError };

export function success<T>(data: T): AppResult<T> {
  return { ok: true, data };
}

export function failure(
  code: AppErrorCode,
  message: string,
  options?: {
    requestId?: string;
    fieldErrors?: Record<string, string[]>;
    diagnostics?: Record<string, string | number | boolean | null>;
  },
): AppResult<never> {
  return {
    ok: false,
    error: {
      code,
      message,
      requestId: options?.requestId ?? crypto.randomUUID(),
      fieldErrors: options?.fieldErrors,
      diagnostics: options?.diagnostics,
    },
  };
}
