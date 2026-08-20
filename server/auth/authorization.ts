import { auth } from "@/auth";
import { AuthenticationMode, OrganizationRole } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { hasRole } from "./roles";

export type AuthorizationContext = {
  userId: string;
  organizationId: string;
  workspaceId: string;
  role: OrganizationRole;
  authMode?: AuthenticationMode;
};

export async function requireUser() {
  const session = await auth();
  if (!session?.user?.id) throw new Error("UNAUTHENTICATED");
  return session.user;
}

export async function getAuthorizationContext(
  workspaceId?: string,
): Promise<AuthorizationContext | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  const workspace = workspaceId
    ? await db.workspace.findFirst({
        where: {
          id: workspaceId,
          organization: { members: { some: { userId: session.user.id } } },
        },
        include: {
          organization: {
            include: { members: { where: { userId: session.user.id } } },
          },
        },
      })
    : await db.workspace.findFirst({
        where: {
          organization: { members: { some: { userId: session.user.id } } },
        },
        include: {
          organization: {
            include: { members: { where: { userId: session.user.id } } },
          },
        },
        orderBy: { createdAt: "asc" },
      });

  const membership = workspace?.organization.members[0];
  if (!workspace || !membership) return null;
  const loginHistory = session.user.loginHistoryId
    ? await db.loginHistory.findFirst({
        where: {
          id: session.user.loginHistoryId,
          userId: session.user.id,
          organizationId: workspace.organizationId,
        },
        select: { authMode: true },
      })
    : null;
  return {
    userId: session.user.id,
    organizationId: workspace.organizationId,
    workspaceId: workspace.id,
    role: membership.role,
    authMode: loginHistory?.authMode ?? "LOCAL",
  };
}

export async function requireAuthorization(
  required: OrganizationRole = OrganizationRole.VIEWER,
  workspaceId?: string,
) {
  const context = await getAuthorizationContext(workspaceId);
  if (!context) throw new Error("FORBIDDEN");
  if (!hasRole(context.role, required)) throw new Error("FORBIDDEN");
  return context;
}
