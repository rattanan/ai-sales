import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { PERMISSIONS, SYSTEM_ROLES } from "@/server/auth/permission-catalog";

export async function provisionOrganizationSystemRoles(
  client: Prisma.TransactionClient,
  organizationId: string,
  systemAdminUserId?: string,
) {
  for (const key of PERMISSIONS) {
    await client.permission.upsert({
      where: { key },
      update: {},
      create: { key },
    });
  }

  for (const [systemKey, definition] of Object.entries(SYSTEM_ROLES)) {
    const existingRole =
      (await client.role.findUnique({
        where: {
          organizationId_systemKey: { organizationId, systemKey },
        },
      })) ??
      (await client.role.findUnique({
        where: {
          organizationId_name: {
            organizationId,
            name: definition.name,
          },
        },
      }));
    const role = existingRole
      ? await client.role.update({
          where: { id: existingRole.id },
          data: {
            systemKey,
            name: definition.name,
            description: definition.description,
            isSystem: true,
          },
        })
      : await client.role.create({
          data: {
            organizationId,
            systemKey,
            name: definition.name,
            description: definition.description,
            isSystem: true,
          },
        });
    const permissionRows = await client.permission.findMany({
      where: { key: { in: [...definition.permissions] } },
      select: { id: true },
    });
    await client.rolePermission.deleteMany({
      where: {
        roleId: role.id,
        permissionId: { notIn: permissionRows.map(({ id }) => id) },
      },
    });
    await client.rolePermission.createMany({
      data: permissionRows.map(({ id: permissionId }) => ({
        roleId: role.id,
        permissionId,
      })),
      skipDuplicates: true,
    });

    if (["ADMIN", "SYSTEM_ADMIN"].includes(systemKey) && systemAdminUserId) {
      await client.userRole.upsert({
        where: {
          organizationId_userId_roleId: {
            organizationId,
            userId: systemAdminUserId,
            roleId: role.id,
          },
        },
        update: {},
        create: { organizationId, userId: systemAdminUserId, roleId: role.id },
      });
    }
  }
}

export async function ensureOrganizationSystemRoles(organizationId: string) {
  const roleCount = await db.role.count({
    where: {
      organizationId,
      systemKey: { in: Object.keys(SYSTEM_ROLES) },
    },
  });
  if (roleCount === Object.keys(SYSTEM_ROLES).length) return;
  await db.$transaction((transaction) =>
    provisionOrganizationSystemRoles(transaction, organizationId),
  );
}
