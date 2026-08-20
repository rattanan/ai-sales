import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { ensureOrganizationSystemRoles } from "@/server/services/system-role-service";

export default async function RolesPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "role.manage");
  await ensureOrganizationSystemRoles(context.organizationId);
  const roles = await db.role.findMany({
    where: { organizationId: context.organizationId },
    include: {
      permissions: { include: { permission: true } },
      _count: { select: { users: true } },
    },
    orderBy: { name: "asc" },
  });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Roles & permissions"
        description="Server-enforced tenant roles and their effective permission grants."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {roles.map((role) => (
          <section key={role.id} className="rounded-xl border bg-card p-5">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="font-semibold">{role.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {role.description}
                </p>
              </div>
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium">
                {role._count.users} users
              </span>
            </div>
            <ul className="mt-4 grid gap-2 sm:grid-cols-2">
              {role.permissions.map(({ permission }) => (
                <li
                  key={permission.id}
                  className="rounded-md bg-slate-50 px-2.5 py-2 font-mono text-xs"
                >
                  {permission.key}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
