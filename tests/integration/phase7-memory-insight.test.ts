import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { createBusinessInsight } from "@/server/services/business-insight-service";
import {
  changeMemoryConsent,
  deleteAllUserMemories,
  saveUserMemory,
} from "@/server/services/user-memory-service";

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!connectionString)("Phase 7 scoped insight and memory", () => {
  it("excludes conversations outside manager department/project scope and deletes memory on request", async () => {
    const suffix = crypto.randomUUID();
    const [manager, outsider] = await Promise.all([
      prisma!.user.create({
        data: {
          email: `phase7-manager-${suffix}@example.test`,
          username: `phase7-manager-${suffix}`,
          status: "ACTIVE",
        },
      }),
      prisma!.user.create({
        data: {
          email: `phase7-outsider-${suffix}@example.test`,
          username: `phase7-outsider-${suffix}`,
          status: "ACTIVE",
        },
      }),
    ]);
    const organization = await prisma!.organization.create({
      data: { name: "Phase 7 insight", slug: `phase7-${suffix}` },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: manager.id,
        name: "Phase 7",
        slug: "phase-7",
      },
    });
    const [departmentA, departmentB, projectA, projectB] = await Promise.all([
      prisma!.organizationUnit.create({
        data: {
          organizationId: organization.id,
          name: "Department A",
          code: `A-${suffix}`,
        },
      }),
      prisma!.organizationUnit.create({
        data: {
          organizationId: organization.id,
          name: "Department B",
          code: `B-${suffix}`,
        },
      }),
      prisma!.organizationProject.create({
        data: {
          organizationId: organization.id,
          name: "Project A",
          code: `PA-${suffix}`,
        },
      }),
      prisma!.organizationProject.create({
        data: {
          organizationId: organization.id,
          name: "Project B",
          code: `PB-${suffix}`,
        },
      }),
    ]);
    const managerMember = await prisma!.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: manager.id,
        role: "VIEWER",
        organizationUnitId: departmentA.id,
        projects: { create: { projectId: projectA.id } },
      },
    });
    await prisma!.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: outsider.id,
        role: "VIEWER",
        organizationUnitId: departmentB.id,
        projects: { create: { projectId: projectB.id } },
      },
    });
    const permission = await prisma!.permission.upsert({
      where: { key: "insight.manage" },
      update: {},
      create: { key: "insight.manage" },
    });
    const role = await prisma!.role.create({
      data: {
        organizationId: organization.id,
        name: "Scoped insight manager",
        systemKey: `P7_${suffix.replaceAll("-", "")}`,
        permissions: { create: { permissionId: permission.id } },
        users: {
          create: { organizationId: organization.id, userId: manager.id },
        },
      },
    });
    expect(role.id).toBeTruthy();
    expect(managerMember.id).toBeTruthy();
    const bot = await prisma!.bot.create({
      data: {
        organizationId: organization.id,
        createdById: manager.id,
        name: "Insight bot",
        systemPrompt: "Use governed evidence only.",
        welcomeMessage: "Hello",
        active: true,
      },
    });
    const createConversation = async (
      index: number,
      userId: string,
      organizationUnitId: string,
      projectId: string,
    ) =>
      prisma!.conversation.create({
        data: {
          organizationId: organization.id,
          botId: bot.id,
          userId,
          title: `Conversation ${index}`,
          organizationUnitId,
          projectId,
          messages: {
            create: [
              { role: "USER", content: "How do I reset payroll access?" },
              {
                role: "ASSISTANT",
                content: "Use the cited support policy.",
                latencyMs: 100,
              },
            ],
          },
        },
      });
    const inScope = await Promise.all(
      [1, 2, 3].map((index) =>
        createConversation(index, manager.id, departmentA.id, projectA.id),
      ),
    );
    const outside = await Promise.all(
      [4, 5].map((index) =>
        createConversation(index, outsider.id, departmentB.id, projectB.id),
      ),
    );
    const context: AuthorizationContext = {
      userId: manager.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      role: "VIEWER",
    };
    const result = await createBusinessInsight(context, {
      dateFrom: new Date(Date.now() - 24 * 60 * 60 * 1_000),
      dateTo: new Date(Date.now() + 24 * 60 * 60 * 1_000),
    });
    expect(result).toMatchObject({ ok: true, data: { status: "COMPLETED" } });
    if (!result.ok) throw new Error("Insight failed");
    const snapshot = await prisma!.businessInsightSnapshot.findFirstOrThrow({
      where: { jobId: result.data.id },
    });
    expect(snapshot).toMatchObject({ conversationCount: 3, messageCount: 6 });
    const evidence = snapshot.evidenceAggregate as {
      conversationIds: string[];
    };
    expect(evidence.conversationIds.sort()).toEqual(
      inScope.map(({ id }) => id).sort(),
    );
    expect(
      evidence.conversationIds.some((id) =>
        outside.map((item) => item.id).includes(id),
      ),
    ).toBe(false);
    await expect(
      createBusinessInsight(context, {
        dateFrom: new Date(),
        dateTo: new Date(),
        organizationUnitId: departmentB.id,
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    await expect(
      changeMemoryConsent(context, {
        status: "GRANTED",
        categories: ["PREFERENCE"],
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      saveUserMemory(context, {
        category: "PREFERENCE",
        key: "response_style",
        value: "Concise Thai",
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      saveUserMemory(context, {
        category: "PREFERENCE",
        key: "api_token",
        value: "secret-value",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(
      await prisma!.userMemory.count({ where: { userId: manager.id } }),
    ).toBe(1);
    await expect(deleteAllUserMemories(context)).resolves.toMatchObject({
      ok: true,
      data: { deletedCount: 1 },
    });
    expect(
      await prisma!.userMemory.count({ where: { userId: manager.id } }),
    ).toBe(0);

    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.deleteMany({
      where: { id: { in: [manager.id, outsider.id] } },
    });
  });
});
