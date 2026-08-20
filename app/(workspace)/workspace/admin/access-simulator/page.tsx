import {
  AccessSimulatorForm,
  ResourceAclForm,
} from "@/components/admin/phase3-forms";
import { PageHeader } from "@/components/ui/page-header";
import { deleteResourceAclAction } from "@/features/admin/authentication-actions";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function AccessSimulatorPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "role.manage");
  const [memberships, roles, rules] = await Promise.all([
    db.organizationMember.findMany({
      where: { organizationId: context.organizationId },
      include: { user: { select: { id: true, name: true, email: true } } },
      orderBy: { user: { name: "asc" } },
    }),
    db.role.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.resourceAcl.findMany({
      where: { organizationId: context.organizationId },
      include: {
        user: { select: { name: true, email: true } },
        role: { select: { name: true } },
      },
      orderBy: [{ resourceType: "asc" }, { resourceId: "asc" }],
    }),
  ]);
  const users = memberships.map(({ user }) => ({
    id: user.id,
    label: `${user.name ?? user.email} (${user.email})`,
  }));
  return (
    <div className="space-y-6">
      <PageHeader
        title="Resource ACL & access simulator"
        description="Manage fine-grained allow/deny rules and explain the central authorization decision before deploying a policy."
      />
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Simulate authorization</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Evaluation order: tenant scope → explicit deny → explicit allow →
            managed or inherited access → deny by default.
          </p>
        </div>
        <AccessSimulatorForm users={users} />
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">Add or replace a resource rule</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            An explicit deny always wins over an allow at the requested access
            level.
          </p>
        </div>
        <ResourceAclForm
          users={users}
          roles={roles.map((role) => ({ id: role.id, label: role.name }))}
        />
      </section>
      <section className="overflow-hidden rounded-xl border bg-card">
        <div className="border-b p-5">
          <h2 className="font-semibold">Current rules</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="p-3">Resource</th>
                <th className="p-3">Principal</th>
                <th className="p-3">Effect</th>
                <th className="p-3">Level</th>
                <th className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rules.map((rule) => (
                <tr key={rule.id}>
                  <td className="p-3">
                    <span className="font-medium">{rule.resourceType}</span>
                    <br />
                    <code className="text-xs">{rule.resourceId}</code>
                  </td>
                  <td className="p-3">
                    {rule.user
                      ? `${rule.user.name ?? rule.user.email} (user)`
                      : `${rule.role?.name} (role)`}
                  </td>
                  <td
                    className={
                      rule.effect === "DENY"
                        ? "p-3 font-semibold text-red-700"
                        : "p-3 font-semibold text-emerald-700"
                    }
                  >
                    {rule.effect}
                  </td>
                  <td className="p-3">{rule.accessLevel}</td>
                  <td className="p-3">
                    <form action={deleteResourceAclAction}>
                      <input type="hidden" name="id" value={rule.id} />
                      <button className="min-h-11 rounded-lg border px-3 text-red-700">
                        Delete
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rules.length ? (
          <p className="p-5 text-sm text-muted-foreground">
            No generic resource rules. Central authorization will use managed
            assignments, inheritance, then deny by default.
          </p>
        ) : null}
      </section>
    </div>
  );
}
