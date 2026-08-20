import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { authorizeResource } from "@/server/auth/resource-authorization";
import {
  EmbeddedAuthenticationError,
  exchangeEmbeddedSession,
  signEmbeddedHmac,
  signEmbeddedJwt,
} from "@/server/auth/embedded-auth";
import { AesGcmCredentialEncryptionService } from "@/server/services/encryption";

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!connectionString)(
  "Phase 3 central resource authorization",
  () => {
    it("covers every resource type, explicit deny precedence, inheritance, tenant scope, and deny by default", async () => {
      const suffix = crypto.randomUUID();
      const user = await prisma!.user.create({
        data: {
          email: `phase3-${suffix}@example.test`,
          username: `phase3-${suffix}`,
          status: "ACTIVE",
        },
      });
      const organization = await prisma!.organization.create({
        data: { name: "Phase 3 ACL", slug: `phase3-${suffix}` },
      });
      const workspace = await prisma!.workspace.create({
        data: {
          organizationId: organization.id,
          createdById: user.id,
          name: "Phase 3",
          slug: "phase-3",
        },
      });
      await prisma!.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          role: "VIEWER",
        },
      });
      const role = await prisma!.role.create({
        data: {
          organizationId: organization.id,
          name: "Phase 3 subject",
          systemKey: `P3_${suffix}`,
        },
      });
      await prisma!.userRole.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          roleId: role.id,
        },
      });
      const bot = await prisma!.bot.create({
        data: {
          organizationId: organization.id,
          createdById: user.id,
          name: "ACL bot",
          systemPrompt: "Grounded",
          welcomeMessage: "Hello",
          active: true,
        },
      });
      const rack = await prisma!.knowledgeRack.create({
        data: {
          organizationId: organization.id,
          createdById: user.id,
          name: "ACL rack",
          sources: { create: { name: "Files" } },
        },
        include: { sources: true },
      });
      const document = await prisma!.document.create({
        data: {
          organizationId: organization.id,
          sourceId: rack.sources[0].id,
          createdById: user.id,
          name: "acl.txt",
          mimeType: "text/plain",
          checksum: suffix.replaceAll("-", ""),
        },
      });
      const dataSource = await prisma!.dataSource.create({
        data: {
          workspaceId: workspace.id,
          createdById: user.id,
          name: "ACL database",
          type: "POSTGRESQL",
          status: "CONNECTED",
          host: "db.example.invalid",
          port: 5432,
          databaseName: "acl",
          username: "readonly",
        },
      });
      const legacyApi = await prisma!.legacyApi.create({
        data: {
          organizationId: organization.id,
          workspaceId: workspace.id,
          createdById: user.id,
          name: "ACL customer search",
          description:
            "Read-only customer lookup used by ACL integration tests.",
          baseUrl: "https://api.example.test/",
          endpointPath: "/customers",
          allowedDomains: ["api.example.test"],
          parameterDefinitions: [],
          responseSchema: { type: "object" },
        },
      });
      const businessInsight = await prisma!.businessInsightJob.create({
        data: {
          organizationId: organization.id,
          workspaceId: workspace.id,
          requestedById: user.id,
          dateFrom: new Date("2026-01-01T00:00:00.000Z"),
          dateTo: new Date("2026-01-31T23:59:59.999Z"),
          status: "INSUFFICIENT_DATA",
          scopeMetadata: { test: true },
        },
      });
      const chat = await prisma!.conversation.create({
        data: {
          organizationId: organization.id,
          botId: bot.id,
          userId: user.id,
          title: "ACL chat",
        },
      });
      const resources = [
        ["BOT", bot.id],
        ["KNOWLEDGE_RACK", rack.id],
        ["KNOWLEDGE_SOURCE", rack.sources[0].id],
        ["DOCUMENT", document.id],
        ["DATA_SOURCE", dataSource.id],
        ["DATABASE_SCHEMA", `${dataSource.id}:public`],
        ["DATABASE_TABLE", `${dataSource.id}:public:orders`],
        ["LEGACY_API", legacyApi.id],
        ["CHAT", chat.id],
        ["INSIGHT", businessInsight.id],
      ] as const;
      await prisma!.resourceAcl.createMany({
        data: resources.map(([resourceType, resourceId]) => ({
          organizationId: organization.id,
          resourceType,
          resourceId,
          roleId: role.id,
          effect: "ALLOW",
          accessLevel: "VIEW",
        })),
      });
      const context: AuthorizationContext = {
        userId: user.id,
        organizationId: organization.id,
        workspaceId: workspace.id,
        role: "VIEWER",
      };
      for (const [resourceType, resourceId] of resources)
        expect(
          (await authorizeResource(context, resourceType, resourceId, "VIEW"))
            .allowed,
        ).toBe(true);
      await prisma!.resourceAcl.create({
        data: {
          organizationId: organization.id,
          resourceType: "BOT",
          resourceId: bot.id,
          userId: user.id,
          effect: "DENY",
          accessLevel: "VIEW",
        },
      });
      expect(
        await authorizeResource(context, "BOT", bot.id, "VIEW"),
      ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
      await prisma!.resourceAcl.create({
        data: {
          organizationId: organization.id,
          resourceType: "DATABASE_TABLE",
          resourceId: `${dataSource.id}:public:orders`,
          userId: user.id,
          effect: "DENY",
          accessLevel: "VIEW",
        },
      });
      expect(
        await authorizeResource(
          context,
          "DATABASE_TABLE",
          `${dataSource.id}:public:orders`,
          "VIEW",
        ),
      ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });
      expect(
        await authorizeResource(context, "INSIGHT", "not-granted", "VIEW"),
      ).toMatchObject({ allowed: false, reason: "DENY_BY_DEFAULT" });
      expect(
        await authorizeResource(
          context,
          "DATABASE_TABLE",
          "outside:public:orders",
          "VIEW",
        ),
      ).toMatchObject({
        allowed: false,
        reason: "TENANT_SCOPE_OR_RESOURCE_NOT_FOUND",
      });
      await prisma!.organization.delete({ where: { id: organization.id } });
      await prisma!.user.delete({ where: { id: user.id } });
    });

    it("rejects tampering, replay, forged claims, cross-origin, expired payloads, and session fixation", async () => {
      const suffix = crypto.randomUUID();
      const owner = await prisma!.user.create({
        data: {
          email: `phase3-owner-${suffix}@example.test`,
          status: "ACTIVE",
        },
      });
      const organization = await prisma!.organization.create({
        data: { name: "Phase 3 Embedded", slug: `phase3-embedded-${suffix}` },
      });
      await prisma!.workspace.create({
        data: {
          organizationId: organization.id,
          createdById: owner.id,
          name: "Embedded",
          slug: "embedded",
        },
      });
      await prisma!.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: owner.id,
          role: "OWNER",
        },
      });
      const role = await prisma!.role.create({
        data: {
          organizationId: organization.id,
          name: `Widget user ${suffix}`,
          systemKey: `WIDGET_${suffix.replaceAll("-", "")}`,
        },
      });
      for (const key of ["bot.use", "chat.use"]) {
        const permission = await prisma!.permission.upsert({
          where: { key },
          update: {},
          create: { key },
        });
        await prisma!.rolePermission.create({
          data: { roleId: role.id, permissionId: permission.id },
        });
      }
      const bot = await prisma!.bot.create({
        data: {
          organizationId: organization.id,
          createdById: owner.id,
          name: "Embedded bot",
          systemPrompt: "Grounded",
          welcomeMessage: "Hello",
          active: true,
          access: {
            create: {
              organizationId: organization.id,
              roleId: role.id,
              level: "USE",
            },
          },
        },
      });
      const secret = "phase3-embedded-signing-secret";
      const envelope = new AesGcmCredentialEncryptionService(
        Buffer.alloc(32),
      ).encrypt(secret);
      const policy = await prisma!.authenticationPolicy.create({
        data: {
          organizationId: organization.id,
          localEnabled: true,
          embeddedEnabled: true,
        },
      });
      await prisma!.embeddedAuthConfig.create({
        data: {
          policyId: policy.id,
          keyId: `key-${suffix}`,
          signatureMode: "BOTH",
          allowedOrigins: ["https://portal.example.com"],
          replayWindowSeconds: 300,
          sessionTtlSeconds: 3600,
          ...envelope,
        },
      });
      const basePayload = {
        externalUserId: `employee-${suffix}`,
        username: `employee-${suffix}`,
        name: "Widget Employee",
        sessionId: `host-session-${suffix}`,
        role: role.name,
        timestamp: Date.now(),
        nonce: crypto.randomUUID().replaceAll("-", "_"),
        origin: "https://portal.example.com",
      };
      const request = (
        payload: typeof basePayload,
        signature = signEmbeddedHmac(payload, secret),
      ) => ({
        botId: bot.id,
        hostOrigin: "https://portal.example.com",
        payload,
        signature,
      });
      const tampered = { ...basePayload, role: "ADMIN" };
      await expect(
        exchangeEmbeddedSession(
          request(tampered, signEmbeddedHmac(basePayload, secret)),
        ),
      ).rejects.toMatchObject({
        code: "INVALID_SIGNATURE",
      } satisfies Partial<EmbeddedAuthenticationError>);
      const forged = {
        ...basePayload,
        nonce: crypto.randomUUID().replaceAll("-", "_"),
        role: "UNMAPPED_ADMIN",
      };
      await expect(
        exchangeEmbeddedSession(request(forged)),
      ).rejects.toMatchObject({
        code: "CLAIM_DENIED",
      } satisfies Partial<EmbeddedAuthenticationError>);
      const expired = {
        ...basePayload,
        nonce: crypto.randomUUID().replaceAll("-", "_"),
        timestamp: Date.now() - 600_000,
      };
      await expect(
        exchangeEmbeddedSession(request(expired)),
      ).rejects.toMatchObject({
        code: "PAYLOAD_EXPIRED",
      } satisfies Partial<EmbeddedAuthenticationError>);
      await expect(
        exchangeEmbeddedSession({
          ...request(basePayload),
          hostOrigin: "https://evil.example.com",
        }),
      ).rejects.toMatchObject({
        code: "ORIGIN_DENIED",
      } satisfies Partial<EmbeddedAuthenticationError>);
      const session = await exchangeEmbeddedSession(request(basePayload));
      expect(session.accessToken).toBeTruthy();
      await expect(
        exchangeEmbeddedSession(request(basePayload)),
      ).rejects.toMatchObject({
        code: "REPLAY_DETECTED",
      } satisfies Partial<EmbeddedAuthenticationError>);
      const shadow = await prisma!.externalIdentity.findUniqueOrThrow({
        where: {
          organizationId_mode_externalUserId: {
            organizationId: organization.id,
            mode: "EMBEDDED",
            externalUserId: basePayload.externalUserId,
          },
        },
        include: { user: true },
      });
      expect(shadow.user).toMatchObject({ isShadow: true, passwordHash: null });
      const fixation = {
        ...basePayload,
        externalUserId: `attacker-${suffix}`,
        username: `attacker-${suffix}`,
        nonce: crypto.randomUUID().replaceAll("-", "_"),
      };
      await expect(
        exchangeEmbeddedSession(request(fixation)),
      ).rejects.toMatchObject({
        code: "SESSION_FIXATION",
      } satisfies Partial<EmbeddedAuthenticationError>);
      const jwtPayload = {
        ...basePayload,
        sessionId: `jwt-session-${suffix}`,
        nonce: crypto.randomUUID().replaceAll("-", "_"),
      };
      const jwt = signEmbeddedJwt(jwtPayload, secret, `key-${suffix}`);
      const jwtSession = await exchangeEmbeddedSession({
        botId: bot.id,
        hostOrigin: jwtPayload.origin,
        token: jwt,
      });
      expect(jwtSession.accessToken).toBeTruthy();
      await prisma!.organization.delete({ where: { id: organization.id } });
      await prisma!.user.delete({ where: { id: owner.id } });
      await prisma!.user.delete({ where: { id: shadow.user.id } });
    });
  },
);
