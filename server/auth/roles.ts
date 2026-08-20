import type { OrganizationRole } from "@/generated/prisma/enums";

const roleRank: Record<OrganizationRole, number> = {
  OWNER: 5,
  ADMIN: 4,
  DASHBOARD_DESIGNER: 3,
  ANALYST: 2,
  VIEWER: 1,
};

export function hasRole(role: OrganizationRole, required: OrganizationRole) {
  return roleRank[role] >= roleRank[required];
}
