import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { authorizeResource } from "@/server/auth/resource-authorization";
import { hasPermission } from "@/server/auth/permissions";

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!connectionString)("Phase 6 Legacy API governance", () => {
  it("requires use permission plus explicit actor ACL and enforces one citation source", async () => {
    const suffix = crypto.randomUUID();
    const user = await prisma!.user.create({
      data: {
        email: `phase6-${suffix}@example.test`,
        username: `phase6-${suffix}`,
        status: "ACTIVE",
      },
    });
    const organization = await prisma!.organization.create({
      data: { name: "Phase 6 API", slug: `phase6-${suffix}` },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Phase 6",
        slug: "phase-6",
      },
    });
    await prisma!.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "VIEWER",
      },
    });
    const permission = await prisma!.permission.upsert({
      where: { key: "legacy_api.use" },
      update: {},
      create: { key: "legacy_api.use" },
    });
    const role = await prisma!.role.create({
      data: {
        organizationId: organization.id,
        name: "API user",
        systemKey: `P6_${suffix.replaceAll("-", "")}`,
        permissions: { create: { permissionId: permission.id } },
        users: {
          create: { organizationId: organization.id, userId: user.id },
        },
      },
    });
    const api = await prisma!.legacyApi.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        createdById: user.id,
        name: "Customer status",
        description: "Returns current customer status by exact identifier.",
        baseUrl: "https://api.example.test/",
        endpointPath: "/customers/{customerId}",
        allowedDomains: ["api.example.test"],
        parameterDefinitions: [
          {
            name: "customerId",
            label: "Customer ID",
            description: "Exact customer identifier",
            location: "PATH",
            type: "STRING",
            required: true,
          },
        ],
        responseSchema: { type: "object" },
      },
    });
    await prisma!.resourceAcl.create({
      data: {
        organizationId: organization.id,
        resourceType: "LEGACY_API",
        resourceId: api.id,
        roleId: role.id,
        effect: "ALLOW",
        accessLevel: "USE",
      },
    });
    const context: AuthorizationContext = {
      userId: user.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      role: "VIEWER",
    };
    expect(await hasPermission(context, "legacy_api.use")).toBe(true);
    expect(
      await authorizeResource(context, "LEGACY_API", api.id, "USE"),
    ).toMatchObject({ allowed: true, reason: "EXPLICIT_ALLOW" });

    const bot = await prisma!.bot.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Phase 6 bot",
        systemPrompt: "Answer only from governed sources.",
        welcomeMessage: "Hello",
        active: true,
      },
    });
    const conversation = await prisma!.conversation.create({
      data: {
        organizationId: organization.id,
        botId: bot.id,
        userId: user.id,
        title: "API citation",
      },
    });
    const message = await prisma!.chatMessage.create({
      data: {
        conversationId: conversation.id,
        role: "ASSISTANT",
        content: "The customer is active.",
      },
    });
    const invocation = await prisma!.legacyApiInvocation.create({
      data: {
        organizationId: organization.id,
        workspaceId: workspace.id,
        legacyApiId: api.id,
        botId: bot.id,
        requestedById: user.id,
        question: "Customer status",
        status: "COMPLETED",
        parameterNames: ["customerId"],
      },
    });
    await expect(
      prisma!.messageCitation.create({
        data: {
          messageId: message.id,
          legacyApiInvocationId: invocation.id,
          rank: 1,
          score: 1,
          quote: "The customer is active.",
        },
      }),
    ).resolves.toMatchObject({ legacyApiInvocationId: invocation.id });
    await expect(
      prisma!.messageCitation.create({
        data: {
          messageId: message.id,
          rank: 2,
          score: 1,
          quote: "Invalid citation",
        },
      }),
    ).rejects.toBeDefined();

    await prisma!.resourceAcl.create({
      data: {
        organizationId: organization.id,
        resourceType: "LEGACY_API",
        resourceId: api.id,
        userId: user.id,
        effect: "DENY",
        accessLevel: "USE",
      },
    });
    expect(
      await authorizeResource(context, "LEGACY_API", api.id, "USE"),
    ).toMatchObject({ allowed: false, reason: "EXPLICIT_DENY" });

    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.delete({ where: { id: user.id } });
  });
});
