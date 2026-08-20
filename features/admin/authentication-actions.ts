"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { env } from "@/schemas/env";
import {
  accessSimulationSchema,
  authenticationPolicyFormSchema,
  externalAuthTestSchema,
  resourceAclFormSchema,
} from "@/schemas/authentication";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { db } from "@/server/db";
import { callExternalAuthentication } from "@/server/auth/external-auth";
import { newSigningSecret } from "@/server/auth/embedded-auth";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";
import { failure, success } from "@/types/result";

function encryption() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

function splitLines(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function jsonHeaders(value: FormDataEntryValue | null) {
  const lines = splitLines(value);
  return Object.fromEntries(
    lines.map((line) => {
      const separator = line.indexOf(":");
      if (separator < 1) throw new Error("INVALID_HEADERS");
      return [
        line.slice(0, separator).trim(),
        line.slice(separator + 1).trim(),
      ];
    }),
  );
}

function authenticationInput(formData: FormData) {
  let externalHeaders: Record<string, string> = {};
  try {
    externalHeaders = jsonHeaders(formData.get("externalHeaders"));
  } catch {
    return null;
  }
  return {
    ...Object.fromEntries(formData),
    modePriority: formData.getAll("modePriority"),
    allowedOrigins: splitLines(formData.get("allowedOrigins")),
    externalHeaders,
  };
}

export async function saveAuthenticationPolicyAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");
  const input = authenticationInput(formData);
  const parsed = authenticationPolicyFormSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      input
        ? "Check the authentication configuration."
        : "Use one Header: value per line.",
      { fieldErrors: parsed.error?.flatten().fieldErrors },
    );
  const existing = await db.authenticationPolicy.findUnique({
    where: { organizationId: context.organizationId },
    include: {
      embeddedConfig: true,
      externalApiConfig: { include: { credential: true } },
    },
  });
  const generated = !existing?.embeddedConfig ? newSigningSecret() : null;
  await db.$transaction(async (tx) => {
    const policy = await tx.authenticationPolicy.upsert({
      where: { organizationId: context.organizationId },
      update: {
        localEnabled: parsed.data.localEnabled,
        externalApiEnabled: parsed.data.externalApiEnabled,
        embeddedEnabled: parsed.data.embeddedEnabled,
        modePriority: parsed.data.modePriority,
      },
      create: {
        organizationId: context.organizationId,
        localEnabled: parsed.data.localEnabled,
        externalApiEnabled: parsed.data.externalApiEnabled,
        embeddedEnabled: parsed.data.embeddedEnabled,
        modePriority: parsed.data.modePriority,
      },
    });
    const embeddedData = {
      signatureMode: parsed.data.signatureMode,
      allowedOrigins: parsed.data.allowedOrigins.map((value) =>
        new URL(value).origin.toLowerCase(),
      ),
      replayWindowSeconds: parsed.data.replayWindowSeconds,
      sessionTtlSeconds: parsed.data.sessionTtlSeconds,
      active: parsed.data.embeddedEnabled,
    };
    if (existing?.embeddedConfig) {
      await tx.embeddedAuthConfig.update({
        where: { id: existing.embeddedConfig.id },
        data: embeddedData,
      });
    } else if (generated) {
      await tx.embeddedAuthConfig.create({
        data: {
          policyId: policy.id,
          keyId: generated.keyId,
          ...encryption().encrypt(generated.secret),
          ...embeddedData,
        },
      });
    }
    if (parsed.data.externalUrl) {
      const externalData = {
        url: parsed.data.externalUrl,
        method: parsed.data.externalMethod,
        timeoutMs: parsed.data.externalTimeoutMs,
        headers: parsed.data.externalHeaders,
        requestMapping: {
          usernameField: parsed.data.requestUsernameField,
          passwordField: parsed.data.requestPasswordField,
        },
        responseMapping: {
          successPath: parsed.data.responseSuccessPath,
          externalUserIdPath: parsed.data.responseExternalUserIdPath,
          usernamePath: parsed.data.responseUsernamePath,
          namePath: parsed.data.responseNamePath,
          rolePath: parsed.data.responseRolePath,
          departmentPath: parsed.data.responseDepartmentPath,
        },
        active: parsed.data.externalApiEnabled,
      };
      const external = await tx.externalAuthConfig.upsert({
        where: { policyId: policy.id },
        update: externalData,
        create: { policyId: policy.id, ...externalData },
      });
      if (parsed.data.secretHeaderName && parsed.data.secretHeaderValue) {
        await tx.externalAuthCredential.upsert({
          where: { configId: external.id },
          update: {
            headerName: parsed.data.secretHeaderName,
            ...encryption().encrypt(parsed.data.secretHeaderValue),
          },
          create: {
            configId: external.id,
            headerName: parsed.data.secretHeaderName,
            ...encryption().encrypt(parsed.data.secretHeaderValue),
          },
        });
      }
    }
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "AUTHENTICATION_POLICY_UPDATED",
        entityType: "AuthenticationPolicy",
        entityId: policy.id,
        afterValue: {
          localEnabled: parsed.data.localEnabled,
          externalApiEnabled: parsed.data.externalApiEnabled,
          embeddedEnabled: parsed.data.embeddedEnabled,
          modePriority: parsed.data.modePriority,
          allowedOrigins: parsed.data.allowedOrigins,
          externalSecretConfigured: Boolean(
            parsed.data.secretHeaderValue ||
            existing?.externalApiConfig?.credential,
          ),
        },
      },
    });
  });
  revalidatePath("/workspace/admin/authentication");
  return success({
    message: generated
      ? "Saved. Copy the signing secret now; it will not be shown again."
      : "Authentication policy saved.",
    signingSecret: generated?.secret,
  });
}

export async function rotateEmbeddedSecretAction(
  _state: unknown,
  _formData: FormData,
) {
  void _state;
  void _formData;
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");
  const config = await db.embeddedAuthConfig.findFirst({
    where: { policy: { organizationId: context.organizationId } },
  });
  if (!config)
    return failure("NOT_FOUND", "Embedded authentication is not configured.");
  const generated = newSigningSecret();
  await db.$transaction([
    db.embeddedAuthConfig.update({
      where: { id: config.id },
      data: {
        keyId: generated.keyId,
        ...encryption().encrypt(generated.secret),
        lastRotatedAt: new Date(),
      },
    }),
    db.externalSession.updateMany({
      where: {
        organizationId: context.organizationId,
        authMode: "EMBEDDED",
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "EMBEDDED_SIGNING_SECRET_ROTATED",
        entityType: "EmbeddedAuthConfig",
        entityId: config.id,
      },
    }),
  ]);
  return success({
    message: "Secret rotated and existing embedded sessions revoked.",
    signingSecret: generated.secret,
  });
}

export async function testExternalAuthenticationAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");
  const parsed = externalAuthTestSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Enter test credentials.");
  const config = await db.externalAuthConfig.findFirst({
    where: { policy: { organizationId: context.organizationId } },
  });
  if (!config)
    return failure("NOT_FOUND", "Save the external configuration first.");
  try {
    const result = await callExternalAuthentication(
      config,
      parsed.data.username,
      parsed.data.password,
    );
    await db.externalAuthConfig.update({
      where: { id: config.id },
      data: {
        lastHealthStatus: result.ok ? "HEALTHY" : "UNHEALTHY",
        lastHealthMessage: result.ok
          ? "Contract and claims validated."
          : result.reason,
        lastHealthLatencyMs: result.latencyMs,
        lastTestedAt: new Date(),
      },
    });
    await db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "EXTERNAL_AUTH_CONFIGURATION_TESTED",
        entityType: "ExternalAuthConfig",
        entityId: config.id,
        outcome: result.ok ? "SUCCESS" : "FAILED",
        metadata: {
          result: result.ok ? "VALID" : result.reason,
          latencyMs: result.latencyMs,
        },
      },
    });
    revalidatePath("/workspace/admin/authentication");
    return result.ok
      ? success({
          message: `Contract valid (${result.latencyMs} ms). Role: ${result.identity.role}`,
        })
      : failure(
          "CONNECTION_FAILED",
          `External authentication rejected the test: ${result.reason}`,
        );
  } catch {
    return failure(
      "CONNECTION_FAILED",
      "External authentication test failed or timed out.",
    );
  }
}

export async function saveResourceAclAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "role.manage");
  const parsed = resourceAclFormSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the resource ACL fields.");
  const principalCount = parsed.data.userId
    ? await db.organizationMember.count({
        where: {
          organizationId: context.organizationId,
          userId: parsed.data.userId,
        },
      })
    : await db.role.count({
        where: {
          organizationId: context.organizationId,
          id: parsed.data.roleId,
        },
      });
  const scoped = await authorizeResource(
    context,
    parsed.data.resourceType,
    parsed.data.resourceId,
    "VIEW",
  );
  if (!principalCount || scoped.reason === "TENANT_SCOPE_OR_RESOURCE_NOT_FOUND")
    return failure(
      "NOT_FOUND",
      "Principal or tenant-scoped resource not found.",
    );
  const existing = await db.resourceAcl.findFirst({
    where: {
      organizationId: context.organizationId,
      resourceType: parsed.data.resourceType,
      resourceId: parsed.data.resourceId,
      userId: parsed.data.userId ?? null,
      roleId: parsed.data.roleId ?? null,
    },
  });
  const acl = existing
    ? await db.resourceAcl.update({
        where: { id: existing.id },
        data: {
          effect: parsed.data.effect,
          accessLevel: parsed.data.accessLevel,
        },
      })
    : await db.resourceAcl.create({
        data: { organizationId: context.organizationId, ...parsed.data },
      });
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: existing ? "RESOURCE_ACL_UPDATED" : "RESOURCE_ACL_CREATED",
      entityType: parsed.data.resourceType,
      entityId: parsed.data.resourceId,
      afterValue: {
        effect: acl.effect,
        accessLevel: acl.accessLevel,
        userId: acl.userId,
        roleId: acl.roleId,
      },
    },
  });
  revalidatePath("/workspace/admin/access-simulator");
  return success({ message: "Resource access rule saved." });
}

export async function deleteResourceAclAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "role.manage");
  const id = String(formData.get("id") ?? "");
  const row = await db.resourceAcl.findFirst({
    where: { id, organizationId: context.organizationId },
  });
  if (!row) return;
  await db.resourceAcl.delete({ where: { id: row.id } });
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "RESOURCE_ACL_DELETED",
      entityType: row.resourceType,
      entityId: row.resourceId,
      beforeValue: {
        effect: row.effect,
        accessLevel: row.accessLevel,
        userId: row.userId,
        roleId: row.roleId,
      },
    },
  });
  revalidatePath("/workspace/admin/access-simulator");
}

export async function simulateResourceAccessAction(
  _state: unknown,
  formData: FormData,
) {
  const admin = await requireAuthorization();
  await requirePermission(admin, "role.manage");
  const parsed = accessSimulationSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the simulation fields.");
  const membership = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: admin.organizationId,
        userId: parsed.data.userId,
      },
    },
  });
  if (!membership)
    return failure("NOT_FOUND", "User is not in this organization.");
  const decision = await authorizeResource(
    { ...admin, userId: parsed.data.userId, role: membership.role },
    parsed.data.resourceType,
    parsed.data.resourceId,
    parsed.data.accessLevel,
  );
  await db.auditLog.create({
    data: {
      organizationId: admin.organizationId,
      workspaceId: admin.workspaceId,
      actorId: admin.userId,
      action: "RESOURCE_ACCESS_SIMULATED",
      entityType: parsed.data.resourceType,
      entityId: parsed.data.resourceId,
      outcome: decision.allowed ? "SUCCESS" : "DENIED",
      requestId: randomUUID(),
      metadata: {
        subjectUserId: parsed.data.userId,
        accessLevel: parsed.data.accessLevel,
        ...decision,
      },
    },
  });
  return success(decision);
}
