import type { AppErrorCode } from "./result";

export type ApiPaginationMeta = {
  cursor?: string;
  nextCursor?: string | null;
  page?: number;
  pageSize?: number;
  total?: number;
};

export type ApiMeta = {
  requestId: string;
  timestamp: string;
  pagination?: ApiPaginationMeta;
};

export type ApiErrorBody = {
  code: AppErrorCode;
  message: string;
  fieldErrors?: Record<string, string[]>;
};

export type ApiSuccess<T> = {
  data: T;
  meta: ApiMeta;
  error: null;
};

export type ApiFailure = {
  data: null;
  meta: ApiMeta;
  error: ApiErrorBody;
};

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;
