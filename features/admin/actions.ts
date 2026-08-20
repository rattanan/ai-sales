"use server";

import { hash } from "@node-rs/argon2";
import { revalidatePath } from "next/cache";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import {
  adminResetPasswordSchema,
  assignRoleSchema,
  createUserSchema,
  updateUserStatusSchema,
  updateUserSchema,
  grantResourceAccessSchema,
  deleteUserSchema,
} from "@/schemas/admin";
import { failure, success, type AppResult } from "@/types/result";

const passwordHash = (password: string) =>
  hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2 });

function userFormData(formData: FormData) {
  return {
    ...Object.fromEntries(formData),
    projectIds: formData.getAll("projectIds"),
  };
}

async function scopeIsValid(
  organizationId: string,
  organizationUnitId: string | undefined,
  projectIds: string[],
) {
  const [unitCount, projectCount] = await Promise.all([
    organizationUnitId
      ? db.organizationUnit.count({
          where: { id: organizationUnitId, organizationId, active: true },
        })
      : Promise.resolve(1),
    db.organizationProject.count({
      where: { id: { in: projectIds }, organizationId, active: true },
    }),
  ]);
  return unitCount === 1 && projectCount === new Set(projectIds).size;
}

export async function createUserAction(_state: unknown, formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.create");
  const parsed = createUserSchema.safeParse(userFormData(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the highlighted user details.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const role = await db.role.findFirst({
    where: { id: parsed.data.roleId, organizationId: context.organizationId },
  });
  if (!role) return failure("NOT_FOUND", "Role not found.");
  if (
    !(await scopeIsValid(
      context.organizationId,
      parsed.data.organizationUnitId,
      parsed.data.projectIds,
    ))
  )
    return failure("VALIDATION_ERROR", "Department or project is invalid.");
  const existing = await db.user.findFirst({
    where: {
      OR: [{ email: parsed.data.email }, { username: parsed.data.username }],
    },
  });
  if (existing)
    return failure("CONFLICT", "Email or username is already in use.");
  const user = await db.$transaction(async (tx) => {
    const created = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        username: parsed.data.username,
        passwordHash: await passwordHash(parsed.data.temporaryPassword),
        status: parsed.data.status,
        mustChangePassword: parsed.data.forcePasswordChange,
        createdById: context.userId,
        memberships: {
          create: {
            organizationId: context.organizationId,
            role: "VIEWER",
            organizationUnitId: parsed.data.organizationUnitId,
            projects: {
              create: parsed.data.projectIds.map((projectId) => ({
                projectId,
              })),
            },
          },
        },
        userRoles: {
          create: { organizationId: context.organizationId, roleId: role.id },
        },
        aiAccessPolicies: {
          create: {
            organizationId: context.organizationId,
            copilotEnabled: parsed.data.copilotEnabled,
          },
        },
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "USER_CREATED",
        entityType: "User",
        entityId: created.id,
        entityName: created.email,
        afterValue: {
          email: created.email,
          username: created.username,
          status: created.status,
          role: role.name,
          organizationUnitId: parsed.data.organizationUnitId,
          projectIds: parsed.data.projectIds,
        },
      },
    });
    return created;
  });
  revalidatePath("/workspace/admin/users");
  return success({ id: user.id });
}

export async function updateUserStatusAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.disable");
  const parsed = updateUserStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success || parsed.data.userId === context.userId) return;
  const before = await db.user.findFirst({
    where: {
      id: parsed.data.userId,
      memberships: { some: { organizationId: context.organizationId } },
    },
  });
  if (!before) return;
  await db.$transaction([
    db.user.update({
      where: { id: before.id },
      data: {
        status: parsed.data.status,
        lockedUntil: parsed.data.status === "LOCKED" ? null : undefined,
        failedLoginCount: parsed.data.status === "ACTIVE" ? 0 : undefined,
        sessionVersion: { increment: 1 },
      },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: `USER_${parsed.data.status}`,
        entityType: "User",
        entityId: before.id,
        entityName: before.email,
        beforeValue: { status: before.status },
        afterValue: { status: parsed.data.status },
      },
    }),
  ]);
  revalidatePath("/workspace/admin/users");
}

export async function resetUserPasswordAction(
  _state: unknown,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.reset_password");
  const parsed = adminResetPasswordSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Use a temporary password of at least 12 characters.",
    );
  const user = await db.user.findFirst({
    where: {
      id: parsed.data.userId,
      memberships: { some: { organizationId: context.organizationId } },
    },
  });
  if (!user) return failure("NOT_FOUND", "User not found.");
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await passwordHash(parsed.data.temporaryPassword),
        mustChangePassword: true,
        status: "ACTIVE",
        sessionVersion: { increment: 1 },
        failedLoginCount: 0,
        lockedUntil: null,
      },
    }),
    db.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "USER_PASSWORD_RESET",
        entityType: "User",
        entityId: user.id,
        entityName: user.email,
      },
    }),
  ]);
  return success({ reset: true });
}

export async function assignUserRoleAction(formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "role.manage");
  const parsed = assignRoleSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return;
  const role = await db.role.findFirst({
    where: { id: parsed.data.roleId, organizationId: context.organizationId },
  });
  if (!role) return;
  await db.$transaction(async (tx) => {
    await tx.userRole.deleteMany({
      where: {
        userId: parsed.data.userId,
        organizationId: context.organizationId,
      },
    });
    await tx.userRole.create({
      data: {
        userId: parsed.data.userId,
        organizationId: context.organizationId,
        roleId: role.id,
      },
    });
    await tx.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "USER_ROLE_CHANGED",
        entityType: "User",
        entityId: parsed.data.userId,
        afterValue: { role: role.name },
      },
    });
  });
  revalidatePath("/workspace/admin/users");
}

export async function updateUserAction(_state: unknown, formData: FormData) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.update");
  const parsed = updateUserSchema.safeParse(userFormData(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Check the user profile details.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  const before = await db.user.findFirst({
    where: {
      id: parsed.data.userId,
      memberships: { some: { organizationId: context.organizationId } },
    },
    include: {
      memberships: {
        where: { organizationId: context.organizationId },
        include: { projects: true },
      },
    },
  });
  if (!before) return failure("NOT_FOUND", "User not found.");
  if (
    !(await scopeIsValid(
      context.organizationId,
      parsed.data.organizationUnitId,
      parsed.data.projectIds,
    ))
  )
    return failure("VALIDATION_ERROR", "Department or project is invalid.");
  const membership = before.memberships[0];
  if (!membership) return failure("NOT_FOUND", "Membership not found.");
  try {
    await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: before.id },
        data: {
          name: parsed.data.name,
          email: parsed.data.email,
          username: parsed.data.username,
        },
      });
      await tx.organizationMember.update({
        where: { id: membership.id },
        data: { organizationUnitId: parsed.data.organizationUnitId ?? null },
      });
      await tx.userProject.deleteMany({
        where: { organizationMemberId: membership.id },
      });
      if (parsed.data.projectIds.length)
        await tx.userProject.createMany({
          data: parsed.data.projectIds.map((projectId) => ({
            organizationMemberId: membership.id,
            projectId,
          })),
        });
      await tx.aIAccessPolicy.upsert({
        where: {
          organizationId_userId: {
            organizationId: context.organizationId,
            userId: before.id,
          },
        },
        update: { copilotEnabled: parsed.data.copilotEnabled },
        create: {
          organizationId: context.organizationId,
          userId: before.id,
          copilotEnabled: parsed.data.copilotEnabled,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          workspaceId: context.workspaceId,
          actorId: context.userId,
          action: "USER_UPDATED",
          entityType: "User",
          entityId: before.id,
          entityName: parsed.data.email,
          beforeValue: {
            name: before.name,
            email: before.email,
            username: before.username,
          },
          afterValue: {
            name: parsed.data.name,
            email: parsed.data.email,
            username: parsed.data.username,
            copilotEnabled: parsed.data.copilotEnabled,
            organizationUnitId: parsed.data.organizationUnitId,
            projectIds: parsed.data.projectIds,
          },
        },
      });
    });
  } catch {
    return failure("CONFLICT", "Email or username is already in use.");
  }
  revalidatePath(`/workspace/admin/users/${before.id}`);
  return success({ updated: true });
}

export async function grantResourceAccessAction(formData: FormData) {
  const context = await requireAuthorization();
  const parsed = grantResourceAccessSchema.safeParse(
    Object.fromEntries(formData),
  );
  if (!parsed.success) return;
  const member = await db.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId: context.organizationId,
        userId: parsed.data.userId,
      },
    },
  });
  if (!member) return;
  if (parsed.data.resourceType === "datasource") {
    await requirePermission(context, "datasource.grant");
    const source = await db.dataSource.findFirst({
      where: { id: parsed.data.resourceId, workspaceId: context.workspaceId },
    });
    if (!source) return;
    await db.dataSourceAccess.upsert({
      where: {
        dataSourceId_userId: {
          dataSourceId: source.id,
          userId: parsed.data.userId,
        },
      },
      update: {
        canPreview: true,
        canBuild: parsed.data.level === "build",
        canManage: parsed.data.level === "manage",
        grantedById: context.userId,
      },
      create: {
        organizationId: context.organizationId,
        dataSourceId: source.id,
        userId: parsed.data.userId,
        canPreview: true,
        canBuild: parsed.data.level === "build",
        canManage: parsed.data.level === "manage",
        grantedById: context.userId,
      },
    });
  } else {
    await requirePermission(context, "role.manage");
    const dashboard = await db.dashboard.findFirst({
      where: { id: parsed.data.resourceId, workspaceId: context.workspaceId },
    });
    if (!dashboard) return;
    const level = parsed.data.level as
      "OWNER" | "EDITOR" | "VIEWER" | "AI_ANALYST";
    if (!["OWNER", "EDITOR", "VIEWER", "AI_ANALYST"].includes(level)) return;
    await db.dashboardAccess.upsert({
      where: {
        dashboardId_userId: {
          dashboardId: dashboard.id,
          userId: parsed.data.userId,
        },
      },
      update: {
        level,
        canExport: parsed.data.canExport,
        grantedById: context.userId,
      },
      create: {
        organizationId: context.organizationId,
        dashboardId: dashboard.id,
        userId: parsed.data.userId,
        level,
        canExport: parsed.data.canExport,
        grantedById: context.userId,
      },
    });
  }
  await db.auditLog.create({
    data: {
      organizationId: context.organizationId,
      workspaceId: context.workspaceId,
      actorId: context.userId,
      action: "RESOURCE_ACCESS_GRANTED",
      entityType: parsed.data.resourceType,
      entityId: parsed.data.resourceId,
      metadata: {
        targetUserId: parsed.data.userId,
        level: parsed.data.level,
        canExport: parsed.data.canExport,
      },
    },
  });
  revalidatePath(`/workspace/admin/users/${parsed.data.userId}`);
}

export async function deleteUserAction(
  _state: AppResult<{ deleted: true }> | null,
  formData: FormData,
) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.delete");
  const parsed = deleteUserSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Enter the user's email to confirm.", {
      fieldErrors: parsed.error.flatten().fieldErrors,
    });
  if (parsed.data.userId === context.userId)
    return failure("CONFLICT", "You cannot delete your own account.");
  const user = await db.user.findFirst({
    where: {
      id: parsed.data.userId,
      memberships: { some: { organizationId: context.organizationId } },
      deletedAt: null,
    },
    include: {
      userRoles: {
        where: { organizationId: context.organizationId },
        select: { role: { select: { systemKey: true } } },
      },
    },
  });
  if (!user) return failure("NOT_FOUND", "User not found.");
  if (user.email.toLowerCase() !== parsed.data.confirmationEmail)
    return failure(
      "VALIDATION_ERROR",
      "The confirmation email does not match.",
      {
        fieldErrors: {
          confirmationEmail: ["Enter the user's exact email address."],
        },
      },
    );
  const isSystemAdmin = user.userRoles.some(
    ({ role }) => role.systemKey === "SYSTEM_ADMIN",
  );
  if (isSystemAdmin) {
    const activeSystemAdmins = await db.userRole.count({
      where: {
        organizationId: context.organizationId,
        role: { systemKey: "SYSTEM_ADMIN" },
        user: { deletedAt: null },
      },
    });
    if (activeSystemAdmins <= 1)
      return failure(
        "CONFLICT",
        "Assign another System Admin before deleting this account.",
      );
  }
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        status: "DISABLED",
        deletedAt: new Date(),
        sessionVersion: { increment: 1 },
      },
    }),
    db.auditLog.create({
      data: {
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
        actorId: context.userId,
        action: "USER_DELETED",
        entityType: "User",
        entityId: user.id,
        entityName: user.email,
      },
    }),
  ]);
  revalidatePath("/workspace/admin/users");
  revalidatePath(`/workspace/admin/users/${user.id}`);
  return success({ deleted: true as const });
}
