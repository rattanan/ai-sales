import { describe, expect, it, vi } from "vitest";
import {
  fetchPublicJsonApi,
  SafeApiError,
  validateOutboundHeaders,
} from "@/packages/legacy-api/safe-fetch";
import { legacyApiRegistrySchema } from "@/schemas/legacy-api";
import {
  buildLegacyApiRequest,
  fallbackLegacyApiToolPlan,
  hasExplicitApiToolIntent,
  mapLegacyApiPayload,
  redactLegacyApiSecretValue,
} from "@/server/services/legacy-api-service";
import {
  parseLegacyApiSourceAssignment,
  pendingLegacyApiSourceId,
} from "@/features/legacy-api/form-utils";

const definitions = [
  {
    name: "customerId",
    label: "Customer ID",
    description: "Exact customer identifier",
    location: "PATH" as const,
    type: "STRING" as const,
    required: true,
  },
  {
    name: "includeOrders",
    label: "Include orders",
    description: "Whether recent orders should be included",
    location: "QUERY" as const,
    type: "BOOLEAN" as const,
    required: false,
    defaultValue: false,
  },
];

function registry(overrides: Record<string, unknown> = {}) {
  return {
    credentialPresent: false,
    name: "Customer lookup",
    description: "Returns the current customer profile by exact identifier.",
    baseUrl: "https://api.example.com",
    endpointPath: "/v1/customers/{customerId}",
    method: "GET",
    readOnlyConfirmed: false,
    enabled: true,
    allowedDomains: ["api.example.com"],
    timeoutMs: 10_000,
    maxResponseBytes: 100_000,
    maxRedirects: 1,
    requestHeaders: {},
    parameters: definitions,
    bodyTemplate: null,
    responseSchema: { type: "object" },
    responseMapping: {},
    authType: "NONE",
    ...overrides,
  };
}

describe("Phase 6 Legacy API registry contracts", () => {
  it("detects an explicit request to use an API tool", () => {
    expect(hasExplicitApiToolIntent("ดึงจาก API tool สิ")).toBe(true);
    expect(hasExplicitApiToolIntent("Summarize the policy")).toBe(false);
  });

  it("routes a weather question to the ready weather tool without inventing inputs", () => {
    const plan = fallbackLegacyApiToolPlan(
      [
        {
          id: "weather-api",
          name: "Weather API",
          description: "Read current weather data from OpenWeatherMap.",
          baseUrl: "https://api.openweathermap.org",
          parameterDefinitions: [
            {
              name: "lat",
              label: "Latitude",
              description: "Latitude for the weather lookup",
              location: "QUERY",
              type: "NUMBER",
              required: true,
            },
            {
              name: "lon",
              label: "Longitude",
              description: "Longitude for the weather lookup",
              location: "QUERY",
              type: "NUMBER",
              required: true,
            },
          ],
        },
      ],
      "วันนี้อากาศเป็นไง",
    );

    expect(plan).toMatchObject({
      intent: "CLARIFICATION",
      apiId: "weather-api",
      parameters: {},
      reason: "MISSING_REQUIRED_API_PARAMETERS",
    });
    expect("clarification" in plan ? plan.clarification : "").toContain(
      "Latitude",
    );
  });

  it("does not route an unrelated knowledge question to an API tool", () => {
    expect(
      fallbackLegacyApiToolPlan(
        [
          {
            id: "weather-api",
            name: "Weather API",
            description: "Read current weather data.",
            baseUrl: "https://api.example.com",
            parameterDefinitions: [],
          },
        ],
        "สรุปนโยบายวันลา",
      ),
    ).toEqual({ intent: "OTHER" });
  });

  it("uses a temporary source id while validating a new API tool", () => {
    expect(pendingLegacyApiSourceId(null)).toBe("pending");
    expect(pendingLegacyApiSourceId("")).toBe("pending");
    expect(pendingLegacyApiSourceId("  ")).toBe("pending");
    expect(pendingLegacyApiSourceId("api-123")).toBe("api-123");
  });

  it("accepts a selected bot assignment for a new unsaved API tool", () => {
    const formData = new FormData();
    formData.set("legacyApiId", "");
    formData.set("sourceScope", "SELECTED_BOTS");
    formData.append("botIds", "bot-123");
    formData.set("enabled", "on");
    formData.set("priority", "100");

    expect(parseLegacyApiSourceAssignment(formData)).toMatchObject({
      success: true,
      data: {
        sourceType: "API_TOOL",
        sourceId: "pending",
        scope: "SELECTED_BOTS",
        botIds: ["bot-123"],
      },
    });
  });

  it.each([
    ["NONE", {}],
    ["API_KEY", { apiKeyHeaderName: "X-API-Key", apiKey: "key-value" }],
    ["QUERY_API_KEY", { queryApiKeyName: "appid", queryApiKey: "key-value" }],
    ["BEARER", { bearerToken: "bearer-value" }],
    ["BASIC", { basicUsername: "readonly", basicPassword: "password-value" }],
    [
      "CUSTOM_HEADER",
      { customHeaderName: "X-Service-Token", customHeaderValue: "secret" },
    ],
  ])("validates %s authentication", (authType, auth) => {
    expect(
      legacyApiRegistrySchema.safeParse(registry({ authType, ...auth }))
        .success,
    ).toBe(true);
  });

  it("removes accidental surrounding whitespace from a query API key", () => {
    const parsed = legacyApiRegistrySchema.safeParse(
      registry({
        authType: "QUERY_API_KEY",
        queryApiKeyName: "appid",
        queryApiKey: "  key-value\t",
      }),
    );

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.queryApiKey).toBe("key-value");
  });

  it("rejects write-like POST registration and plaintext auth headers", () => {
    expect(
      legacyApiRegistrySchema.safeParse(
        registry({ method: "POST", readOnlyConfirmed: false }),
      ).success,
    ).toBe(false);
    expect(
      legacyApiRegistrySchema.safeParse(
        registry({ requestHeaders: { Authorization: "Bearer plaintext" } }),
      ).success,
    ).toBe(false);
    expect(
      legacyApiRegistrySchema.safeParse(
        registry({
          baseUrl: "http://api.example.com",
          authType: "BEARER",
          bearerToken: "bearer-value",
        }),
      ).success,
    ).toBe(false);
  });

  it("asks for required parameters before constructing a network request", () => {
    const result = buildLegacyApiRequest({
      baseUrl: "https://api.example.com",
      endpointPath: "/v1/customers/{customerId}",
      method: "GET",
      definitions,
      supplied: {},
      requestHeaders: {},
      bodyTemplate: null,
      secret: null,
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        request: null,
        missing: [{ name: "customerId", label: "Customer ID" }],
      },
    });
  });

  it("binds only declared path/query values and injects encrypted-boundary auth", () => {
    const result = buildLegacyApiRequest({
      baseUrl: "https://api.example.com/ignored",
      endpointPath: "/v1/customers/{customerId}",
      method: "GET",
      definitions,
      supplied: { customerId: "A/B", includeOrders: true },
      requestHeaders: { "x-client": "insightkm" },
      bodyTemplate: null,
      secret: { apiKeyHeaderName: "X-API-Key", apiKey: "encrypted-secret" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.request) return;
    expect(result.data.request.url).toBe(
      "https://api.example.com/v1/customers/A%2FB?includeOrders=true",
    );
    expect(result.data.request.headers).toEqual({
      "x-client": "insightkm",
      "X-API-Key": "encrypted-secret",
    });
    expect(
      buildLegacyApiRequest({
        baseUrl: "https://api.example.com",
        endpointPath: "/v1/customers/{customerId}",
        method: "GET",
        definitions,
        supplied: { customerId: "1", host: "evil.test" },
        requestHeaders: {},
        bodyTemplate: null,
        secret: null,
      }),
    ).toMatchObject({ ok: false });
  });

  it("injects an encrypted query API key after public query parameters", () => {
    const result = buildLegacyApiRequest({
      baseUrl: "https://api.openweathermap.org",
      endpointPath: "/data/2.5/weather",
      method: "GET",
      definitions: [
        {
          name: "q",
          label: "City",
          description: "City name",
          location: "QUERY",
          type: "STRING",
          required: true,
        },
      ],
      supplied: { q: "Bangkok" },
      requestHeaders: {},
      bodyTemplate: null,
      secret: { queryApiKeyName: "appid", queryApiKey: "encrypted-secret" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok || !result.data.request) return;
    expect(result.data.request.url).toBe(
      "https://api.openweathermap.org/data/2.5/weather?q=Bangkok&appid=encrypted-secret",
    );
    expect(result.data.request.headers).toEqual({});
  });

  it("maps registered response paths without prototype traversal", () => {
    const payload = { data: { customer: { name: "Ada" } } };
    expect(
      mapLegacyApiPayload(payload, {
        customerName: "data.customer.name",
        denied: "data.__proto__.polluted",
      }),
    ).toEqual({ customerName: "Ada", denied: undefined });
  });

  it("redacts an echoed credential even when general privacy masking is disabled", () => {
    expect(
      redactLegacyApiSecretValue(
        "upstream echoed bearer-secret in a diagnostic",
        ["bearer-secret"],
      ),
    ).toBe("upstream echoed [REDACTED] in a diagnostic");
  });
});

describe("Phase 6 safe HTTP boundary", () => {
  const validateUrl = vi.fn(async (raw: string) => ({
    url: new URL(raw),
    address: "93.184.216.34",
    family: 4,
  }));

  it.each([
    ["none", null, null],
    [
      "API key",
      { apiKeyHeaderName: "X-API-Key", apiKey: "api-secret" },
      ["X-API-Key", "api-secret"],
    ],
    [
      "bearer",
      { bearerToken: "bearer-secret" },
      ["authorization", "Bearer bearer-secret"],
    ],
    [
      "basic",
      { basicUsername: "readonly", basicPassword: "basic-secret" },
      [
        "authorization",
        `Basic ${Buffer.from("readonly:basic-secret").toString("base64")}`,
      ],
    ],
    [
      "custom header",
      {
        customHeaderName: "X-Service-Token",
        customHeaderValue: "custom-secret",
      },
      ["X-Service-Token", "custom-secret"],
    ],
  ])(
    "passes %s auth only through the bounded request",
    async (_name, secret, expected) => {
      const built = buildLegacyApiRequest({
        baseUrl: "https://api.example.com",
        endpointPath: "/health",
        method: "GET",
        definitions: [],
        supplied: {},
        requestHeaders: {},
        bodyTemplate: null,
        secret,
      });
      expect(built.ok).toBe(true);
      if (!built.ok || !built.data.request) return;
      const requestOnce = vi.fn(
        async (request: { headers: Record<string, string> }) => {
          if (expected)
            expect(request.headers[expected[0] as string]).toBe(expected[1]);
          else expect(request.headers).toEqual({});
          return {
            status: 200,
            headers: { "content-type": "application/json" },
            bytes: Buffer.from('{"ok":true}'),
          };
        },
      );
      await expect(
        fetchPublicJsonApi(
          {
            url: built.data.request.url,
            allowedDomains: ["api.example.com"],
            method: "GET",
            headers: built.data.request.headers,
            timeoutMs: 1_000,
            maxBytes: 1_024,
            maxRedirects: 0,
          },
          { validateUrl, requestOnce },
        ),
      ).resolves.toMatchObject({ payload: { ok: true } });
      expect(requestOnce).toHaveBeenCalledOnce();
    },
  );

  it("rejects header injection and protected transport headers", () => {
    expect(() => validateOutboundHeaders({ Host: "evil.test" })).toThrowError(
      SafeApiError,
    );
    expect(() =>
      validateOutboundHeaders({ "x-safe": "value\r\nx-injected: true" }),
    ).toThrowError(SafeApiError);
  });

  it("blocks private targets before a request is sent", async () => {
    const requestOnce = vi.fn();
    await expect(
      fetchPublicJsonApi(
        {
          url: "http://169.254.169.254/latest",
          allowedDomains: ["169.254.169.254"],
          method: "GET",
          headers: {},
          timeoutMs: 1_000,
          maxBytes: 1_024,
          maxRedirects: 0,
        },
        {
          validateUrl: vi.fn(async () => {
            throw Object.assign(new Error("private"), {
              code: "PRIVATE_ADDRESS_DENIED",
            });
          }),
          requestOnce,
        },
      ),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_DENIED" });
    expect(requestOnce).not.toHaveBeenCalled();
  });

  it("blocks cross-origin redirects", async () => {
    await expect(
      fetchPublicJsonApi(
        {
          url: "https://api.example.com/start",
          allowedDomains: ["api.example.com"],
          method: "GET",
          headers: {},
          timeoutMs: 1_000,
          maxBytes: 1_024,
          maxRedirects: 1,
        },
        {
          validateUrl,
          requestOnce: vi.fn(async () => ({
            status: 302,
            headers: { location: "https://evil.test/steal" },
            bytes: Buffer.alloc(0),
          })),
        },
      ),
    ).rejects.toMatchObject({ code: "REDIRECT_DENIED" });
  });

  it("explains an upstream 401 as a credential problem", async () => {
    await expect(
      fetchPublicJsonApi(
        {
          url: "https://api.example.com/data",
          allowedDomains: ["api.example.com"],
          method: "GET",
          headers: {},
          timeoutMs: 1_000,
          maxBytes: 1_024,
          maxRedirects: 0,
        },
        {
          validateUrl,
          requestOnce: vi.fn(async () => ({
            status: 401,
            headers: { "content-type": "application/json" },
            bytes: Buffer.from('{"message":"Invalid API key"}'),
          })),
        },
      ),
    ).rejects.toThrowError(
      "The API rejected the credential (HTTP 401). Check that the API key is correct and active, then try again.",
    );
  });

  it("rejects oversized, non-JSON, and malformed JSON responses", async () => {
    const base = {
      url: "https://api.example.com/data",
      allowedDomains: ["api.example.com"],
      method: "GET" as const,
      headers: {},
      timeoutMs: 1_000,
      maxBytes: 10,
      maxRedirects: 0,
    };
    await expect(
      fetchPublicJsonApi(base, {
        validateUrl,
        requestOnce: vi.fn(async () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          bytes: Buffer.alloc(11),
        })),
      }),
    ).rejects.toMatchObject({ code: "RESPONSE_TOO_LARGE" });
    await expect(
      fetchPublicJsonApi(
        { ...base, maxBytes: 100 },
        {
          validateUrl,
          requestOnce: vi.fn(async () => ({
            status: 200,
            headers: { "content-type": "text/html" },
            bytes: Buffer.from("<html></html>"),
          })),
        },
      ),
    ).rejects.toMatchObject({ code: "CONTENT_TYPE_DENIED" });
    await expect(
      fetchPublicJsonApi(
        { ...base, maxBytes: 100 },
        {
          validateUrl,
          requestOnce: vi.fn(async () => ({
            status: 200,
            headers: { "content-type": "application/json" },
            bytes: Buffer.from("not-json"),
          })),
        },
      ),
    ).rejects.toMatchObject({ code: "INVALID_JSON" });
  });
});
