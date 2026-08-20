import { createHash } from "node:crypto";
import type { ExternalAuthConfig } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import { consumeRateLimit } from "@/server/services/rate-limit";

type Mapping = {
  usernameField: string;
  passwordField: string;
};

type ResponseMapping = {
  successPath: string;
  externalUserIdPath: string;
  usernamePath?: string;
  namePath?: string;
  rolePath: string;
  departmentPath?: string;
};

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pathValue(value: unknown, path: string | undefined) {
  if (!path) return undefined;
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((current, key) => objectValue(current)[key], value);
}

function requestContext(request?: Request) {
  const userAgent = request?.headers.get("user-agent")?.slice(0, 500) ?? null;
  const ipAddress =
    request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request?.headers.get("x-real-ip") ||
    null;
  const lower = userAgent?.toLowerCase() ?? "";
  return {
    ipAddress,
    userAgent,
    browser: lower.includes("firefox")
      ? "Firefox"
      : lower.includes("edg/")
        ? "Edge"
        : lower.includes("chrome")
          ? "Chrome"
          : lower.includes("safari")
            ? "Safari"
            : "Unknown",
    operatingSystem: lower.includes("windows")
      ? "Windows"
      : lower.includes("mac os")
        ? "macOS"
        : lower.includes("android")
          ? "Android"
          : lower.includes("iphone") || lower.includes("ipad")
            ? "iOS"
            : lower.includes("linux")
              ? "Linux"
              : "Unknown",
    device: /mobile|android|iphone/.test(lower) ? "Mobile" : "Desktop",
  };
}

function encryptionService() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

async function externalHeaders(configId: string, headers: unknown) {
  const safeHeaders = Object.fromEntries(
    Object.entries(objectValue(headers))
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key, String(value)]),
  );
  const credential = await db.externalAuthCredential.findUnique({
    where: { configId },
  });
  if (credential)
    safeHeaders[credential.headerName] =
      encryptionService().decrypt(credential);
  return safeHeaders;
}

export async function callExternalAuthentication(
  config: ExternalAuthConfig,
  username: string,
  password: string,
) {
  const requestMapping = objectValue(config.requestMapping) as Mapping;
  const responseMapping = objectValue(
    config.responseMapping,
  ) as ResponseMapping;
  if (!requestMapping.usernameField || !requestMapping.passwordField)
    throw new Error("External authentication request mapping is invalid");
  const requestPayload = {
    [requestMapping.usernameField]: username,
    [requestMapping.passwordField]: password,
  };
  const url = new URL(config.url);
  const headers = await externalHeaders(config.id, config.headers);
  let body: string | undefined;
  if (config.method === "GET") {
    for (const [key, value] of Object.entries(requestPayload))
      url.searchParams.set(key, value);
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(requestPayload);
  }
  const startedAt = performance.now();
  const response = await fetch(url, {
    method: config.method,
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(config.timeoutMs),
  });
  const latencyMs = Math.round(performance.now() - startedAt);
  if (!response.ok)
    return {
      ok: false as const,
      reason: `HTTP_${response.status}`,
      latencyMs,
    };
  const payload = (await response.json().catch(() => null)) as unknown;
  if (pathValue(payload, responseMapping.successPath) !== true)
    return { ok: false as const, reason: "REJECTED", latencyMs };
  const externalUserId = pathValue(payload, responseMapping.externalUserIdPath);
  const role = pathValue(payload, responseMapping.rolePath);
  if (typeof externalUserId !== "string" || typeof role !== "string")
    return { ok: false as const, reason: "INVALID_MAPPING", latencyMs };
  const stringClaim = (path: string | undefined) => {
    const value = pathValue(payload, path);
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
  };
  return {
    ok: true as const,
    latencyMs,
    identity: {
      externalUserId: externalUserId.trim(),
      username: stringClaim(responseMapping.usernamePath) ?? username,
      name: stringClaim(responseMapping.namePath),
      role: role.trim(),
      department: stringClaim(responseMapping.departmentPath),
    },
  };
}

function syntheticIdentity(organizationId: string, externalUserId: string) {
  const suffix = createHash("sha256")
    .update(`${organizationId}:${externalUserId}:external-api`)
    .digest("hex")
    .slice(0, 24);
  return {
    email: `external.${suffix}@shadow.insightkm.invalid`,
    username: `external_${suffix}`,
  };
}

async function auditExternalLogin(input: {
  organizationId: string;
  userId?: string;
  identifier: string;
  success: boolean;
  reason: string;
  request?: Request;
}) {
  const context = requestContext(input.request);
  const history = await db.loginHistory.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId,
      identifier: input.identifier,
      status: input.success ? "SUCCESS" : "FAILED",
      failureReason: input.success ? null : input.reason,
      authMode: "EXTERNAL_API",
      ...context,
    },
  });
  await db.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.userId,
      actorName: input.identifier,
      action: input.success ? "EXTERNAL_AUTH_SUCCESS" : "EXTERNAL_AUTH_FAILED",
      entityType: "User",
      entityId: input.userId,
      outcome: input.success ? "SUCCESS" : "FAILED",
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      metadata: { authMode: "EXTERNAL_API", reason: input.reason },
    },
  });
  return history;
}

export async function authenticateExternalCredentials(
  organizationId: string,
  identifier: string,
  password: string,
  request?: Request,
) {
  const context = requestContext(request);
  const configuration = env();
  const limits = await Promise.all(
    [
      ...new Set(
        [identifier.trim().toLowerCase(), context.ipAddress].filter(Boolean),
      ),
    ].map((key) =>
      consumeRateLimit(
        "external-login",
        String(key),
        configuration.LOGIN_RATE_LIMIT_MAX_ATTEMPTS,
        configuration.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
      ),
    ),
  );
  if (limits.some((allowed) => !allowed)) return null;
  const policy = await db.authenticationPolicy.findUnique({
    where: { organizationId },
    include: { externalApiConfig: true },
  });
  const config = policy?.externalApiConfig;
  if (!policy?.externalApiEnabled || !config?.active) {
    await auditExternalLogin({
      organizationId,
      identifier,
      success: false,
      reason: "MODE_DISABLED",
      request,
    });
    return null;
  }
  let result: Awaited<ReturnType<typeof callExternalAuthentication>>;
  try {
    result = await callExternalAuthentication(config, identifier, password);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError"
        ? "TIMEOUT"
        : "PROVIDER_FAILURE";
    await auditExternalLogin({
      organizationId,
      identifier,
      success: false,
      reason,
      request,
    });
    return null;
  }
  if (!result.ok) {
    await auditExternalLogin({
      organizationId,
      identifier,
      success: false,
      reason: result.reason,
      request,
    });
    return null;
  }
  const [role, organizationUnit] = await Promise.all([
    db.role.findFirst({
      where: {
        organizationId,
        OR: [
          { systemKey: result.identity.role.toUpperCase() },
          { name: { equals: result.identity.role, mode: "insensitive" } },
        ],
      },
    }),
    result.identity.department
      ? db.organizationUnit.findFirst({
          where: {
            organizationId,
            active: true,
            OR: [
              { code: result.identity.department.toUpperCase() },
              {
                name: {
                  equals: result.identity.department,
                  mode: "insensitive",
                },
              },
            ],
          },
        })
      : null,
  ]);
  if (!role || (result.identity.department && !organizationUnit)) {
    await auditExternalLogin({
      organizationId,
      identifier,
      success: false,
      reason: "CLAIM_DENIED",
      request,
    });
    return null;
  }
  const identityValues = syntheticIdentity(
    organizationId,
    result.identity.externalUserId,
  );
  const user = await db.$transaction(async (tx) => {
    const existing = await tx.externalIdentity.findUnique({
      where: {
        organizationId_mode_externalUserId: {
          organizationId,
          mode: "EXTERNAL_API",
          externalUserId: result.identity.externalUserId,
        },
      },
    });
    const shadow = existing
      ? await tx.user.update({
          where: { id: existing.userId },
          data: {
            name: result.identity.name ?? result.identity.username,
            status: "ACTIVE",
            deletedAt: null,
            isShadow: true,
            passwordHash: null,
          },
        })
      : await tx.user.create({
          data: {
            ...identityValues,
            name: result.identity.name ?? result.identity.username,
            status: "ACTIVE",
            isShadow: true,
          },
        });
    await tx.organizationMember.upsert({
      where: { organizationId_userId: { organizationId, userId: shadow.id } },
      update: { organizationUnitId: organizationUnit?.id ?? null },
      create: {
        organizationId,
        userId: shadow.id,
        role: "VIEWER",
        organizationUnitId: organizationUnit?.id,
      },
    });
    await tx.userRole.deleteMany({
      where: { organizationId, userId: shadow.id },
    });
    await tx.userRole.create({
      data: { organizationId, userId: shadow.id, roleId: role.id },
    });
    await tx.externalIdentity.upsert({
      where: {
        organizationId_mode_externalUserId: {
          organizationId,
          mode: "EXTERNAL_API",
          externalUserId: result.identity.externalUserId,
        },
      },
      update: {
        userId: shadow.id,
        externalUsername: result.identity.username,
        metadata: {
          role: role.systemKey ?? role.name,
          department: organizationUnit?.code ?? null,
        },
      },
      create: {
        organizationId,
        userId: shadow.id,
        mode: "EXTERNAL_API",
        externalUserId: result.identity.externalUserId,
        externalUsername: result.identity.username,
        metadata: {
          role: role.systemKey ?? role.name,
          department: organizationUnit?.code ?? null,
        },
      },
    });
    return shadow;
  });
  const history = await auditExternalLogin({
    organizationId,
    userId: user.id,
    identifier,
    success: true,
    reason: "AUTHENTICATED",
    request,
  });
  await db.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });
  return { user, loginHistoryId: history.id };
}
