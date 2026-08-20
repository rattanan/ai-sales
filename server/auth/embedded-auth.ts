import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { requireBotUse } from "@/server/auth/knowledge-access";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import {
  embeddedIdentityPayloadSchema,
  embeddedSessionRequestSchema,
} from "@/schemas/authentication";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import type { z } from "zod";

export type EmbeddedIdentityPayload = z.infer<
  typeof embeddedIdentityPayloadSchema
>;
export type EmbeddedSessionRequest = z.infer<
  typeof embeddedSessionRequestSchema
>;

export class EmbeddedAuthenticationError extends Error {
  constructor(
    public readonly code:
      | "CONFIGURATION_ERROR"
      | "INVALID_SIGNATURE"
      | "PAYLOAD_EXPIRED"
      | "REPLAY_DETECTED"
      | "ORIGIN_DENIED"
      | "CLAIM_DENIED"
      | "SESSION_FIXATION"
      | "SESSION_INVALID",
  ) {
    super(code);
  }
}

function encryptionService() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

function base64Url(value: Buffer | string) {
  return Buffer.from(value).toString("base64url");
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizeOrigin(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol))
    throw new EmbeddedAuthenticationError("ORIGIN_DENIED");
  return url.origin.toLowerCase();
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
    .join(",")}}`;
}

export function signEmbeddedHmac(
  payload: EmbeddedIdentityPayload,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(stableStringify(payload))
    .digest("base64url");
}

export function signEmbeddedJwt(
  payload: EmbeddedIdentityPayload,
  secret: string,
  keyId: string,
) {
  const header = base64Url(
    JSON.stringify({ alg: "HS256", typ: "JWT", kid: keyId }),
  );
  const body = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function signaturesMatch(expected: string, received: string) {
  const left = Buffer.from(expected);
  const right = Buffer.from(received);
  return left.length === right.length && timingSafeEqual(left, right);
}

function verifiedJwt(token: string, secret: string, keyId: string) {
  const parts = token.split(".");
  if (parts.length !== 3)
    throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
  const [encodedHeader, encodedPayload, signature] = parts;
  let header: { alg?: string; kid?: string };
  let payload: unknown;
  try {
    header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString());
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
  }
  if (header.alg !== "HS256" || header.kid !== keyId)
    throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
  const expected = createHmac("sha256", secret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest("base64url");
  if (!signaturesMatch(expected, signature))
    throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
  const parsed = embeddedIdentityPayloadSchema.safeParse(payload);
  if (!parsed.success)
    throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
  return parsed.data;
}

async function audit(
  organizationId: string,
  botId: string,
  outcome: "SUCCESS" | "DENIED" | "FAILED",
  reason: string,
  origin: string,
  actorId?: string,
) {
  await db.auditLog.create({
    data: {
      organizationId,
      actorId,
      action:
        outcome === "SUCCESS"
          ? "EMBEDDED_AUTH_SUCCESS"
          : "EMBEDDED_AUTH_FAILED",
      entityType: "Bot",
      entityId: botId,
      outcome,
      metadata: { authMode: "EMBEDDED", reason, origin },
    },
  });
}

export async function recordEmbeddedAuthenticationFailure(
  botId: string,
  origin: string,
  reason: string,
) {
  const bot = await db.bot.findUnique({
    where: { id: botId },
    select: { id: true, organizationId: true },
  });
  if (!bot) return;
  await audit(
    bot.organizationId,
    bot.id,
    "FAILED",
    reason,
    origin.slice(0, 500),
  );
}

function syntheticIdentity(organizationId: string, externalUserId: string) {
  const suffix = digest(`${organizationId}:${externalUserId}`).slice(0, 24);
  return {
    email: `embedded.${suffix}@shadow.insightkm.invalid`,
    username: `embedded_${suffix}`,
  };
}

export async function exchangeEmbeddedSession(input: EmbeddedSessionRequest) {
  const bot = await db.bot.findFirst({
    where: { id: input.botId, active: true },
    include: {
      organization: {
        include: {
          authenticationPolicy: { include: { embeddedConfig: true } },
        },
      },
    },
  });
  if (!bot) throw new EmbeddedAuthenticationError("CONFIGURATION_ERROR");
  const policy = bot.organization.authenticationPolicy;
  const config = policy?.embeddedConfig;
  const attemptedOrigin = normalizeOrigin(input.hostOrigin);
  if (!policy?.embeddedEnabled || !config?.active) {
    await audit(
      bot.organizationId,
      bot.id,
      "DENIED",
      "MODE_DISABLED",
      attemptedOrigin,
    );
    throw new EmbeddedAuthenticationError("CONFIGURATION_ERROR");
  }
  const allowedOrigins = config.allowedOrigins.map(normalizeOrigin);
  if (!allowedOrigins.includes(attemptedOrigin)) {
    await audit(
      bot.organizationId,
      bot.id,
      "DENIED",
      "ORIGIN_DENIED",
      attemptedOrigin,
    );
    throw new EmbeddedAuthenticationError("ORIGIN_DENIED");
  }
  const secret = encryptionService().decrypt(config);
  let payload: EmbeddedIdentityPayload;
  if (input.token) {
    if (config.signatureMode === "HMAC_SHA256")
      throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
    payload = verifiedJwt(input.token, secret, config.keyId);
  } else {
    if (
      config.signatureMode === "JWT_HS256" ||
      !input.payload ||
      !input.signature ||
      !signaturesMatch(signEmbeddedHmac(input.payload, secret), input.signature)
    )
      throw new EmbeddedAuthenticationError("INVALID_SIGNATURE");
    payload = input.payload;
  }
  if (normalizeOrigin(payload.origin) !== attemptedOrigin)
    throw new EmbeddedAuthenticationError("ORIGIN_DENIED");
  const timestampMs =
    payload.timestamp > 10_000_000_000
      ? payload.timestamp
      : payload.timestamp * 1_000;
  if (Math.abs(Date.now() - timestampMs) > config.replayWindowSeconds * 1_000)
    throw new EmbeddedAuthenticationError("PAYLOAD_EXPIRED");
  const [role, organizationUnit] = await Promise.all([
    db.role.findFirst({
      where: {
        organizationId: bot.organizationId,
        OR: [
          { systemKey: payload.role.toUpperCase() },
          { name: { equals: payload.role, mode: "insensitive" } },
        ],
      },
    }),
    payload.department
      ? db.organizationUnit.findFirst({
          where: {
            organizationId: bot.organizationId,
            active: true,
            OR: [
              { code: payload.department.toUpperCase() },
              { name: { equals: payload.department, mode: "insensitive" } },
            ],
          },
        })
      : null,
  ]);
  if (!role || (payload.department && !organizationUnit))
    throw new EmbeddedAuthenticationError("CLAIM_DENIED");
  try {
    await db.embeddedAuthNonce.create({
      data: {
        configId: config.id,
        nonceHash: digest(payload.nonce),
        expiresAt: new Date(timestampMs + config.replayWindowSeconds * 1_000),
      },
    });
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "P2002"
    )
      throw new EmbeddedAuthenticationError("REPLAY_DETECTED");
    throw error;
  }
  const externalUserId = payload.externalUserId ?? payload.username!;
  const opaqueToken = randomBytes(32).toString("base64url");
  const tokenHash = digest(opaqueToken);
  const identity = syntheticIdentity(bot.organizationId, externalUserId);
  const provisioned = await db.$transaction(async (tx) => {
    const existingIdentity = await tx.externalIdentity.findUnique({
      where: {
        organizationId_mode_externalUserId: {
          organizationId: bot.organizationId,
          mode: "EMBEDDED",
          externalUserId,
        },
      },
      include: { user: true },
    });
    const user = existingIdentity
      ? await tx.user.update({
          where: { id: existingIdentity.userId },
          data: {
            name: payload.name ?? payload.username ?? externalUserId,
            status: "ACTIVE",
            deletedAt: null,
            isShadow: true,
            passwordHash: null,
          },
        })
      : await tx.user.create({
          data: {
            ...identity,
            name: payload.name ?? payload.username ?? externalUserId,
            status: "ACTIVE",
            isShadow: true,
          },
        });
    await tx.organizationMember.upsert({
      where: {
        organizationId_userId: {
          organizationId: bot.organizationId,
          userId: user.id,
        },
      },
      update: { organizationUnitId: organizationUnit?.id ?? null },
      create: {
        organizationId: bot.organizationId,
        userId: user.id,
        role: "VIEWER",
        organizationUnitId: organizationUnit?.id,
      },
    });
    await tx.userRole.deleteMany({
      where: { organizationId: bot.organizationId, userId: user.id },
    });
    await tx.userRole.create({
      data: {
        organizationId: bot.organizationId,
        userId: user.id,
        roleId: role.id,
      },
    });
    await tx.externalIdentity.upsert({
      where: {
        organizationId_mode_externalUserId: {
          organizationId: bot.organizationId,
          mode: "EMBEDDED",
          externalUserId,
        },
      },
      update: {
        userId: user.id,
        externalUsername: payload.username,
        lastExternalSessionId: payload.sessionId,
        metadata: {
          role: role.systemKey ?? role.name,
          department: organizationUnit?.code ?? null,
        },
      },
      create: {
        organizationId: bot.organizationId,
        userId: user.id,
        mode: "EMBEDDED",
        externalUserId,
        externalUsername: payload.username,
        lastExternalSessionId: payload.sessionId,
        metadata: {
          role: role.systemKey ?? role.name,
          department: organizationUnit?.code ?? null,
        },
      },
    });
    const existingSession = await tx.externalSession.findUnique({
      where: {
        organizationId_botId_externalSessionId: {
          organizationId: bot.organizationId,
          botId: bot.id,
          externalSessionId: payload.sessionId,
        },
      },
    });
    if (existingSession && existingSession.userId !== user.id)
      throw new EmbeddedAuthenticationError("SESSION_FIXATION");
    const externalSession = existingSession
      ? await tx.externalSession.update({
          where: { id: existingSession.id },
          data: {
            tokenHash,
            origin: attemptedOrigin,
            expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
            revokedAt: null,
            lastSeenAt: new Date(),
          },
        })
      : await tx.externalSession.create({
          data: {
            organizationId: bot.organizationId,
            botId: bot.id,
            userId: user.id,
            authMode: "EMBEDDED",
            externalSessionId: payload.sessionId,
            origin: attemptedOrigin,
            tokenHash,
            expiresAt: new Date(Date.now() + config.sessionTtlSeconds * 1_000),
          },
        });
    return { user, externalSession };
  });
  const workspace = await db.workspace.findFirst({
    where: { organizationId: bot.organizationId },
    orderBy: { createdAt: "asc" },
  });
  if (!workspace) throw new EmbeddedAuthenticationError("CONFIGURATION_ERROR");
  const context: AuthorizationContext = {
    userId: provisioned.user.id,
    organizationId: bot.organizationId,
    workspaceId: workspace.id,
    role: "VIEWER",
  };
  try {
    await requireBotUse(context, bot.id);
  } catch {
    await db.externalSession.update({
      where: { id: provisioned.externalSession.id },
      data: { revokedAt: new Date() },
    });
    await audit(
      bot.organizationId,
      bot.id,
      "DENIED",
      "BOT_ACCESS_DENIED",
      attemptedOrigin,
      provisioned.user.id,
    );
    throw new EmbeddedAuthenticationError("CLAIM_DENIED");
  }
  await audit(
    bot.organizationId,
    bot.id,
    "SUCCESS",
    "AUTHENTICATED",
    attemptedOrigin,
    provisioned.user.id,
  );
  return {
    accessToken: opaqueToken,
    expiresAt: provisioned.externalSession.expiresAt,
    conversationId: provisioned.externalSession.conversationId,
    bot: {
      id: bot.id,
      name: bot.name,
      welcomeMessage: bot.welcomeMessage,
      suggestedQuestions: Array.isArray(bot.suggestedQuestions)
        ? bot.suggestedQuestions.filter(
            (question): question is string => typeof question === "string",
          )
        : [],
    },
  };
}

export async function authenticateExternalSession(
  accessToken: string,
  botId: string,
) {
  const externalSession = await db.externalSession.findFirst({
    where: {
      tokenHash: digest(accessToken),
      botId,
      authMode: "EMBEDDED",
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!externalSession)
    throw new EmbeddedAuthenticationError("SESSION_INVALID");
  const [workspace, membership] = await Promise.all([
    db.workspace.findFirst({
      where: { organizationId: externalSession.organizationId },
      orderBy: { createdAt: "asc" },
    }),
    db.organizationMember.findUnique({
      where: {
        organizationId_userId: {
          organizationId: externalSession.organizationId,
          userId: externalSession.userId,
        },
      },
    }),
  ]);
  if (!workspace || !membership)
    throw new EmbeddedAuthenticationError("SESSION_INVALID");
  await db.externalSession.update({
    where: { id: externalSession.id },
    data: { lastSeenAt: new Date() },
  });
  return {
    externalSession,
    context: {
      userId: externalSession.userId,
      organizationId: externalSession.organizationId,
      workspaceId: workspace.id,
      role: membership.role,
      authMode: externalSession.authMode,
    } satisfies AuthorizationContext,
  };
}

export function bearerToken(request: Request) {
  const value = request.headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
}

export function newSigningSecret() {
  return { keyId: randomUUID(), secret: randomBytes(32).toString("base64url") };
}
