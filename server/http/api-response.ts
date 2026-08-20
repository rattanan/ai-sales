import type {
  ApiErrorBody,
  ApiPaginationMeta,
  ApiResponse,
} from "../../types/api-response";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9._:-]{8,128}$/;

export function requestIdFrom(request: Request) {
  const candidate = request.headers.get("x-request-id")?.trim();
  return candidate && REQUEST_ID_PATTERN.test(candidate)
    ? candidate
    : crypto.randomUUID();
}

function responseMeta(requestId: string, pagination?: ApiPaginationMeta) {
  return {
    requestId,
    timestamp: new Date().toISOString(),
    ...(pagination ? { pagination } : {}),
  };
}

export function apiSuccess<T>(
  request: Request,
  data: T,
  options?: {
    status?: number;
    pagination?: ApiPaginationMeta;
  },
) {
  const requestId = requestIdFrom(request);
  const body: ApiResponse<T> = {
    data,
    meta: responseMeta(requestId, options?.pagination),
    error: null,
  };
  return Response.json(body, {
    status: options?.status ?? 200,
    headers: { "x-request-id": requestId },
  });
}

export function apiFailure(
  request: Request,
  error: ApiErrorBody,
  options?: { status?: number },
) {
  const requestId = requestIdFrom(request);
  const body: ApiResponse<never> = {
    data: null,
    meta: responseMeta(requestId),
    error,
  };
  return Response.json(body, {
    status: options?.status ?? 500,
    headers: { "x-request-id": requestId },
  });
}
