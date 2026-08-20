import Link from "next/link";
import { OrganizationScopeForm } from "@/components/admin/phase1-forms";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";

export default async function NewOrganizationScopePage() {
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Add organization scope"
        description="Create a department or project scope, then assign it to users from the user administration page."
      />
      <Button asChild variant="outline">
        <Link href="/workspace/admin/scopes">Back to organization scopes</Link>
      </Button>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
          <div>
            <h2 className="font-semibold">Department / organization unit</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              A user can be assigned to one department or organization unit.
            </p>
          </div>
          <OrganizationScopeForm kind="unit" />
        </section>
        <section className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
          <div>
            <h2 className="font-semibold">Project</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Users can participate in any number of project scopes.
            </p>
          </div>
          <OrganizationScopeForm kind="project" />
        </section>
      </div>
    </div>
  );
}
