import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { db } from "@/server/db";
import { env } from "@/schemas/env";

const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export async function createPasswordReset(
  email: string,
  createdByAdmin = false,
) {
  const user = await db.user.findUnique({
    where: { email: email.toLowerCase() },
    include: { memberships: { take: 1 } },
  });
  const token = randomBytes(32).toString("base64url");
  if (!user || user.deletedAt || user.status === "DISABLED") return { token };
  const expiresAt = new Date(
    Date.now() + env().PASSWORD_RESET_TOKEN_EXPIRY_MINUTES * 60_000,
  );
  await db.$transaction([
    db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: digest(token),
        expiresAt,
        createdByAdmin,
      },
    }),
    ...(user.memberships[0]
      ? [
          db.auditLog.create({
            data: {
              organizationId: user.memberships[0].organizationId,
              actorId: createdByAdmin ? undefined : user.id,
              action: "PASSWORD_RESET_REQUESTED",
              entityType: "User",
              entityId: user.id,
              entityName: user.email,
            },
          }),
        ]
      : []),
  ]);
  return { token, userId: user.id };
}

export async function consumePasswordReset(token: string, password: string) {
  const reset = await db.passwordResetToken.findUnique({
    where: { tokenHash: digest(token) },
    include: { user: { include: { memberships: { take: 1 } } } },
  });
  if (!reset || reset.usedAt || reset.expiresAt <= new Date()) return false;
  const passwordHash = await hash(password, {
    algorithm: 2,
    memoryCost: 19456,
    timeCost: 2,
  });
  await db.$transaction([
    db.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    }),
    db.passwordResetToken.updateMany({
      where: { userId: reset.userId, id: { not: reset.id }, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.user.update({
      where: { id: reset.userId },
      data: {
        passwordHash,
        mustChangePassword: false,
        failedLoginCount: 0,
        lockedUntil: null,
        status: "ACTIVE",
        sessionVersion: { increment: 1 },
      },
    }),
    ...(reset.user.memberships[0]
      ? [
          db.auditLog.create({
            data: {
              organizationId: reset.user.memberships[0].organizationId,
              actorId: reset.userId,
              action: "PASSWORD_RESET_COMPLETED",
              entityType: "User",
              entityId: reset.userId,
            },
          }),
        ]
      : []),
  ]);
  return true;
}

export async function changeTemporaryPassword(
  userId: string,
  currentPassword: string,
  password: string,
) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (
    !user?.passwordHash ||
    !(await verify(user.passwordHash, currentPassword))
  )
    return false;
  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hash(password, {
        algorithm: 2,
        memoryCost: 19456,
        timeCost: 2,
      }),
      mustChangePassword: false,
      status: "ACTIVE",
      sessionVersion: { increment: 1 },
    },
  });
  return true;
}
