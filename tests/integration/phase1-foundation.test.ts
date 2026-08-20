import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/schemas/env";
import { AesGcmCredentialEncryptionService } from "@/server/services/encryption";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = process.env.TEST_DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL,
      }),
    })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!enabled)(
  "Phase 1 organization and provider foundation",
  () => {
    it("persists tenant scopes and keeps provider secrets encrypted and excluded", async () => {
      const suffix = crypto.randomUUID();
      const organization = await prisma!.organization.create({
        data: { name: "Phase 1 Test", slug: `phase-1-${suffix}` },
      });
      const user = await prisma!.user.create({
        data: {
          email: `phase-1-${suffix}@example.test`,
          username: `phase-1-${suffix}`,
          status: "ACTIVE",
        },
      });
      const unit = await prisma!.organizationUnit.create({
        data: {
          organizationId: organization.id,
          name: "Operations",
          code: "OPS",
        },
      });
      const project = await prisma!.organizationProject.create({
        data: {
          organizationId: organization.id,
          name: "Knowledge Modernization",
          code: "KM",
        },
      });
      await prisma!.organizationMember.create({
        data: {
          organizationId: organization.id,
          userId: user.id,
          organizationUnitId: unit.id,
          projects: { create: { projectId: project.id } },
        },
      });
      const provider = await prisma!.llmProvider.create({
        data: {
          organizationId: organization.id,
          name: "Primary",
          baseUrl: "https://api.example.test/v1",
          chatModel: "chat",
          embeddingModel: "embedding",
        },
      });
      const environment = env();
      const encryption = new AesGcmCredentialEncryptionService(
        Buffer.from(environment.CREDENTIAL_ENCRYPTION_KEY, "base64"),
        environment.CREDENTIAL_KEY_VERSION,
      );
      const envelope = encryption.encrypt("phase-1-provider-secret");
      await prisma!.llmProviderCredential.create({
        data: { providerId: provider.id, ...envelope },
      });
      await prisma!.piiMaskingPolicy.create({
        data: { organizationId: organization.id },
      });
      await prisma!.systemRetentionPolicy.create({
        data: { organizationId: organization.id },
      });

      const browserSafeProvider = await prisma!.llmProvider.findUniqueOrThrow({
        where: { id: provider.id },
      });
      expect(JSON.stringify(browserSafeProvider)).not.toContain(
        "phase-1-provider-secret",
      );
      expect(JSON.stringify(browserSafeProvider)).not.toContain("ciphertext");
      const stored = await prisma!.llmProviderCredential.findUniqueOrThrow({
        where: { providerId: provider.id },
      });
      expect(stored.ciphertext).not.toContain("phase-1-provider-secret");
      expect(encryption.decrypt(stored)).toBe("phase-1-provider-secret");
      expect(
        await prisma!.userProject.count({
          where: {
            projectId: project.id,
            organizationMember: { userId: user.id },
          },
        }),
      ).toBe(1);

      await prisma!.organization.delete({ where: { id: organization.id } });
      await prisma!.user.delete({ where: { id: user.id } });
    });
  },
);
