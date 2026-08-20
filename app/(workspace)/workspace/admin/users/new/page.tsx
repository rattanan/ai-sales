import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { CreateUserForm } from "@/components/admin/create-user-form";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { ensureOrganizationSystemRoles } from "@/server/services/system-role-service";

export default async function NewUserPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "user.create");
  await ensureOrganizationSystemRoles(context.organizationId);
  const [roles, organizationUnits, projects] = await Promise.all([
    db.role.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true, description: true, systemKey: true },
      orderBy: { name: "asc" },
    }),
    db.organizationUnit.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.organizationProject.findMany({
      where: { organizationId: context.organizationId, active: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Create user"
        description="Issue a temporary credential and least-privilege role assignment."
      />
      <Card>
        <CardContent className="pt-6">
          <CreateUserForm
            roles={roles}
            organizationUnits={organizationUnits}
            projects={projects}
          />
        </CardContent>
      </Card>
    </div>
  );
}
