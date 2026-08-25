import { env } from "@/schemas/env";
import { userNtopApiKey } from "@/server/services/ntop-credential-service";

type Collection<T = Record<string, unknown>> = { data: T[] };
type Resource<T = Record<string, unknown>> = { data: T };

export class NtopApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "NtopApiError";
  }
}

function errorDetails(value: unknown) {
  if (!value || typeof value !== "object" || !("error" in value)) return null;
  const error = (value as { error?: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : "NTOP_API_ERROR",
    message:
      typeof record.message === "string"
        ? record.message
        : "NTOP rejected the request.",
  };
}

export class NtopClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly timeoutMs = 15_000,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(
        `${this.baseUrl.replace(/\/$/, "")}${path}`,
        {
          ...init,
          cache: "no-store",
          signal: controller.signal,
          headers: {
            accept: "application/json",
            authorization: `Bearer ${this.apiKey}`,
            "content-type": "application/json",
            "x-correlation-id": crypto.randomUUID(),
            ...(init.headers ?? {}),
          },
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const details = errorDetails(payload);
        throw new NtopApiError(
          response.status,
          details?.code ?? "NTOP_API_ERROR",
          details?.message ?? `NTOP returned HTTP ${response.status}.`,
        );
      }
      return payload as T;
    } catch (error) {
      if (error instanceof NtopApiError) throw error;
      if (error instanceof Error && error.name === "AbortError")
        throw new NtopApiError(
          504,
          "NTOP_TIMEOUT",
          "NTOP did not respond before the timeout.",
        );
      throw new NtopApiError(
        503,
        "NTOP_UNAVAILABLE",
        "NTOP is currently unavailable.",
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private search(path: string, query: string) {
    return this.request<Collection>(
      `${path}?q=${encodeURIComponent(query)}&limit=10`,
    ).then(({ data }) => data);
  }

  searchCustomer(query: string) {
    return this.search("/customers", query);
  }
  searchProspect(query: string) {
    return this.search("/prospects", query);
  }
  searchLead(query: string) {
    return this.search("/leads", query);
  }
  searchOpportunity(query: string) {
    return this.search("/opportunities", query);
  }
  searchProduct(query: string) {
    return this.search("/products", query);
  }
  searchQuotation(query: string) {
    return this.search("/quotes", query);
  }
  getCustomer(id: string) {
    return this.request<Resource>(`/customers/${encodeURIComponent(id)}`).then(
      ({ data }) => data,
    );
  }
  getProspect(id: string) {
    return this.request<Resource>(`/prospects/${encodeURIComponent(id)}`).then(
      ({ data }) => data,
    );
  }
  getLead(id: string) {
    return this.request<Resource>(`/leads/${encodeURIComponent(id)}`).then(
      ({ data }) => data,
    );
  }
  getOpportunity(id: string) {
    return this.request<Resource>(
      `/opportunities/${encodeURIComponent(id)}`,
    ).then(({ data }) => data);
  }
  getQuotation(id: string) {
    return this.request<Resource>(`/quotes/${encodeURIComponent(id)}`).then(
      ({ data }) => data,
    );
  }
  getProduct(id: string) {
    return this.request<Resource>(`/products/${encodeURIComponent(id)}`).then(
      ({ data }) => data,
    );
  }

  private create(
    path: string,
    payload: Record<string, unknown>,
    idempotencyKey: string,
  ) {
    return this.request<Resource>(path, {
      method: "POST",
      headers: { "idempotency-key": idempotencyKey },
      body: JSON.stringify(payload),
    }).then(({ data }) => data);
  }

  createProspect(payload: Record<string, unknown>, key: string) {
    return this.create("/prospects", payload, key);
  }
  createLead(payload: Record<string, unknown>, key: string) {
    return this.create("/leads", payload, key);
  }
  createOpportunity(payload: Record<string, unknown>, key: string) {
    return this.create("/opportunities", payload, key);
  }
  createQuotation(payload: Record<string, unknown>, key: string) {
    return this.create("/quotes", payload, key);
  }
  updateOpportunity(
    id: string,
    version: number,
    payload: Record<string, unknown>,
    key: string,
  ) {
    return this.request<Resource>(`/opportunities/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "idempotency-key": key, "if-match": String(version) },
      body: JSON.stringify(payload),
    }).then(({ data }) => data);
  }
}

export function configuredNtopClient() {
  const configuration = env();
  return configuration.NTOP_API_URL && configuration.NTOP_API_KEY
    ? new NtopClient(
        configuration.NTOP_API_URL,
        configuration.NTOP_API_KEY,
        configuration.NTOP_API_TIMEOUT_MS,
      )
    : null;
}

export async function configuredNtopClientForUser(
  userId: string,
  options: { allowLegacyKey?: boolean } = {},
) {
  return (
    (await configuredNtopConnectionForUser(userId, options))?.client ?? null
  );
}

export async function configuredNtopConnectionForUser(
  userId: string,
  options: { allowLegacyKey?: boolean } = {},
) {
  const configuration = env();
  if (!configuration.NTOP_API_URL) return null;
  const personalApiKey = await userNtopApiKey(userId);
  const apiKey =
    personalApiKey ||
    (options.allowLegacyKey ? configuration.NTOP_API_KEY : undefined);
  return apiKey
    ? {
        client: new NtopClient(
          configuration.NTOP_API_URL,
          apiKey,
          configuration.NTOP_API_TIMEOUT_MS,
        ),
        credentialSource: personalApiKey
          ? ("USER" as const)
          : ("LEGACY" as const),
      }
    : null;
}
