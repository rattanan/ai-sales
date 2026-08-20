import Link from "next/link";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { toggleOrganizationScopeAction } from "@/features/admin/config-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function OrganizationScopesPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");
  const [units, projects] = await Promise.all([
    db.organizationUnit.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
    }),
    db.organizationProject.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
    }),
  ]);
  const groups = [
    {
      title: "Departments / organization units",
      kind: "unit" as const,
      rows: units,
    },
    { title: "Projects", kind: "project" as const, rows: projects },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Organization scopes"
        description="Assign users to one department and any number of projects."
        action={
          <Button asChild>
            <Link href="/workspace/admin/scopes/new">Add scope</Link>
          </Button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-2">
        {groups.map((group) => (
          <section
            key={group.kind}
            className="space-y-5 rounded-xl border bg-card p-5"
          >
            <h2 className="font-semibold">{group.title}</h2>
            <div className="divide-y">
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center justify-between gap-4 py-3 text-sm"
                >
                  <div>
                    <p className="font-medium">{row.name}</p>
                    <p className="text-muted-foreground">
                      {row.code}
                      {row.description ? ` · ${row.description}` : ""}
                    </p>
                  </div>
                  <form action={toggleOrganizationScopeAction}>
                    <input type="hidden" name="id" value={row.id} />
                    <input type="hidden" name="kind" value={group.kind} />
                    <input
                      type="hidden"
                      name="active"
                      value={String(!row.active)}
                    />
                    <button className="min-h-10 rounded-lg border px-3">
                      {row.active ? "Disable" : "Enable"}
                    </button>
                  </form>
                </div>
              ))}
              {!group.rows.length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  No entries yet.
                </p>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
