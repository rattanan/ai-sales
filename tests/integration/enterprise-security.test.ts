import { afterAll, describe, expect, it } from "vitest";
import { hash } from "@node-rs/argon2";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { hasPermission } from "@/server/auth/permissions";
import { authenticateCredentials } from "@/server/services/login-security";
import {
  consumePasswordReset,
  createPasswordReset,
} from "@/server/services/password-reset";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const prisma = process.env.TEST_DATABASE_URL
  ? new PrismaClient({
      adapter: new PrismaPg({
        connectionString: process.env.TEST_DATABASE_URL,
      }),
    })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!enabled)("enterprise account security integration", () => {
  it("locks an account after repeated invalid passwords", async () => {
    const suffix = crypto.randomUUID();
    const password = "TemporaryPassword1";
    const user = await prisma!.user.create({
      data: {
        name: "Lock Test",
        email: `lock-${suffix}@example.test`,
        username: `lock-${suffix}`,
        passwordHash: await hash(password, {
          algorithm: 2,
          memoryCost: 19456,
          timeCost: 2,
        }),
        status: "ACTIVE",
      },
    });
    const organization = await prisma!.organization.create({
      data: {
        name: "Lock Test",
        slug: `lock-${suffix}`,
        members: { create: { userId: user.id } },
      },
    });
    const request = new Request("http://localhost/login", {
      headers: {
        "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 100) + 100}`,
      },
    });
    for (let attempt = 0; attempt < 5; attempt += 1)
      expect(
        await authenticateCredentials(
          user.username!,
          "InvalidPassword1",
          request,
        ),
      ).toBeNull();
    expect(
      await prisma!.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({
      status: "LOCKED",
      failedLoginCount: 5,
      sessionVersion: 2,
    });
    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.delete({ where: { id: user.id } });
  });

  it("enforces permissions, reset expiry, session invalidation, and disabled login", async () => {
    const suffix = crypto.randomUUID();
    const password = "TemporaryPassword1";
    const user = await prisma!.user.create({
      data: {
        name: "Security Test",
        email: `security-${suffix}@example.test`,
        username: `security-${suffix}`,
        passwordHash: await hash(password, {
          algorithm: 2,
          memoryCost: 19456,
          timeCost: 2,
        }),
        status: "PENDING_ACTIVATION",
        mustChangePassword: true,
      },
    });
    const organization = await prisma!.organization.create({
      data: { name: "Security", slug: `security-${suffix}` },
    });
    await prisma!.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "VIEWER",
      },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Security",
        slug: "security",
      },
    });
    const permission = await prisma!.permission.upsert({
      where: { key: "dashboard.view" },
      update: {},
      create: { key: "dashboard.view" },
    });
    const role = await prisma!.role.create({
      data: {
        organizationId: organization.id,
        name: "Security Viewer",
        permissions: { create: { permissionId: permission.id } },
        users: { create: { organizationId: organization.id, userId: user.id } },
      },
    });
    expect(role.id).toBeTruthy();
    const context = {
      userId: user.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      role: "VIEWER" as const,
    };
    expect(await hasPermission(context, "dashboard.view")).toBe(true);
    expect(await hasPermission(context, "dashboard.update")).toBe(false);

    const expired = await createPasswordReset(user.email);
    await prisma!.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(await consumePasswordReset(expired.token, "ChangedPassword1")).toBe(
      false,
    );
    const valid = await createPasswordReset(user.email);
    expect(await consumePasswordReset(valid.token, "ChangedPassword1")).toBe(
      true,
    );
    expect(
      await prisma!.user.findUnique({ where: { id: user.id } }),
    ).toMatchObject({
      status: "ACTIVE",
      mustChangePassword: false,
      sessionVersion: 2,
    });

    await prisma!.user.update({
      where: { id: user.id },
      data: { status: "DISABLED" },
    });
    expect(
      await authenticateCredentials(
        user.email,
        "ChangedPassword1",
        new Request("http://localhost/login", {
          headers: {
            "x-forwarded-for": "192.0.2.20",
            "user-agent": "Security test",
          },
        }),
      ),
    ).toBeNull();
    expect(
      await prisma!.loginHistory.count({
        where: { userId: user.id, failureReason: "ACCOUNT_DISABLED" },
      }),
    ).toBe(1);
    expect(
      await prisma!.auditLog.count({
        where: {
          organizationId: organization.id,
          action: "LOGIN_FAILED",
          outcome: "DENIED",
        },
      }),
    ).toBe(1);

    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.delete({ where: { id: user.id } });
  });
});
