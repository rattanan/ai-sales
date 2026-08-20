import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalAuthConfig } from "@/generated/prisma/client";
import { embeddedIdentityPayloadSchema } from "@/schemas/authentication";
import {
  signEmbeddedHmac,
  signEmbeddedJwt,
  stableStringify,
} from "@/server/auth/embedded-auth";
import { callExternalAuthentication } from "@/server/auth/external-auth";

vi.mock("@/server/db", () => ({
  db: {
    externalAuthCredential: { findUnique: vi.fn().mockResolvedValue(null) },
  },
}));

afterEach(() => vi.restoreAllMocks());

describe("Phase 3 authentication primitives", () => {
  const payload = embeddedIdentityPayloadSchema.parse({
    externalUserId: "employee-42",
    username: "somchai",
    name: "Somchai",
    sessionId: "host-session-123",
    role: "USER",
    department: "OPS",
    timestamp: 1_800_000_000,
    nonce: "nonce_value_123456789",
    origin: "https://portal.example.com",
  });

  it("canonicalizes payload keys and changes HMAC when a signed role is tampered", () => {
    expect(stableStringify({ z: 1, a: { y: 2, x: 3 } })).toBe(
      '{"a":{"x":3,"y":2},"z":1}',
    );
    const secret = "phase-3-test-secret";
    const valid = signEmbeddedHmac(payload, secret);
    const forged = signEmbeddedHmac({ ...payload, role: "ADMIN" }, secret);
    expect(valid).not.toBe(forged);
  });

  it("emits an HS256 JWT with the configured key ID", () => {
    const token = signEmbeddedJwt(payload, "phase-3-test-secret", "key-v1");
    const [header, body] = token.split(".");
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      alg: "HS256",
      typ: "JWT",
      kid: "key-v1",
    });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toMatchObject(
      {
        externalUserId: "employee-42",
        role: "USER",
      },
    );
  });

  it("maps the external authentication request and response contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        accepted: true,
        profile: {
          employeeId: "E-42",
          username: "somchai",
          displayName: "Somchai",
          roleCode: "USER",
          departmentCode: "OPS",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      id: "external-config",
      url: "https://identity.example.com/authenticate",
      method: "POST",
      headers: { "x-tenant": "acme" },
      requestMapping: { usernameField: "login", passwordField: "secret" },
      responseMapping: {
        successPath: "accepted",
        externalUserIdPath: "profile.employeeId",
        usernamePath: "profile.username",
        namePath: "profile.displayName",
        rolePath: "profile.roleCode",
        departmentPath: "profile.departmentCode",
      },
      timeoutMs: 2_000,
    } as unknown as ExternalAuthConfig;
    const result = await callExternalAuthentication(
      config,
      "somchai",
      "not-stored",
    );
    expect(result).toMatchObject({
      ok: true,
      identity: { externalUserId: "E-42", role: "USER", department: "OPS" },
    });
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      login: "somchai",
      secret: "not-stored",
    });
    expect(init.headers).toMatchObject({
      "x-tenant": "acme",
      "content-type": "application/json",
    });
  });

  it("rejects an external response when success is not exactly true", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ accepted: "true" })),
    );
    const result = await callExternalAuthentication(
      {
        id: "external-config",
        url: "https://identity.example.com/authenticate",
        method: "POST",
        headers: {},
        requestMapping: {
          usernameField: "username",
          passwordField: "password",
        },
        responseMapping: {
          successPath: "accepted",
          externalUserIdPath: "user.id",
          rolePath: "user.role",
        },
        timeoutMs: 2_000,
      } as unknown as ExternalAuthConfig,
      "user",
      "password",
    );
    expect(result).toMatchObject({ ok: false, reason: "REJECTED" });
  });
});
