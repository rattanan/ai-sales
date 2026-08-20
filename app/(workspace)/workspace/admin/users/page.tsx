import Link from "next/link";
import { requireAuthorization } from "@/server/auth/authorization";
import { hasPermission, requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";
import { PageHeader } from "@/components/ui/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { UserTableActions } from "@/components/admin/user-table-actions";

export const metadata = { title: "User administration" };
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const context = await requireAuthorization();
  await requirePermission(context, "user.create");
  const query = await searchParams;
  const page = Math.max(1, Number(query.page) || 1);
  const where = {
    memberships: { some: { organizationId: context.organizationId } },
    deletedAt: null,
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: "insensitive" as const } },
            { email: { contains: query.q, mode: "insensitive" as const } },
            { username: { contains: query.q, mode: "insensitive" as const } },
          ],
        }
      : {}),
    ...(query.status
      ? {
          status: query.status as
            "ACTIVE" | "LOCKED" | "DISABLED" | "PENDING_ACTIVATION",
        }
      : {}),
  };
  const [users, total, canEdit, canDisable, canDelete] = await Promise.all([
    db.user.findMany({
      where,
      include: {
        userRoles: {
          where: { organizationId: context.organizationId },
          include: { role: true },
        },
        createdBy: { select: { name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * 20,
      take: 20,
    }),
    db.user.count({ where }),
    hasPermission(context, "user.update"),
    hasPermission(context, "user.disable"),
    hasPermission(context, "user.delete"),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Users"
        description="Provision accounts, assign roles, and control account access."
        action={
          <Link href="/workspace/admin/users/new">
            <Button>Create user</Button>
          </Link>
        }
      />
      <form className="grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[1fr_220px_auto]">
        <input
          name="q"
          defaultValue={query.q}
          placeholder="Search name, email, or username"
          className="min-h-11 rounded-lg border px-3"
        />
        <select
          name="status"
          defaultValue={query.status ?? ""}
          className="min-h-11 rounded-lg border bg-white px-3"
        >
          <option value="">All statuses</option>
          <option value="PENDING_ACTIVATION">Pending activation</option>
          <option value="ACTIVE">Active</option>
          <option value="LOCKED">Locked</option>
          <option value="DISABLED">Disabled</option>
        </select>
        <Button variant="secondary">Filter</Button>
      </form>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase text-muted-foreground">
            <tr>
              {[
                "User",
                "Role",
                "Status",
                "Last login",
                "Failures",
                "Created",
                "Actions",
              ].map((label) => (
                <th key={label} className="px-4 py-3">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b last:border-0">
                <td className="px-4 py-4">
                  <Link
                    href={`/workspace/admin/users/${user.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {user.name}
                  </Link>
                  <p className="text-xs text-muted-foreground">
                    {user.email} · @{user.username}
                  </p>
                </td>
                <td className="px-4">
                  {user.userRoles.map((item) => item.role.name).join(", ") ||
                    "Unassigned"}
                </td>
                <td className="px-4">
                  <Badge
                    tone={
                      user.status === "ACTIVE"
                        ? "success"
                        : user.status === "LOCKED"
                          ? "warning"
                          : user.status === "DISABLED"
                            ? "danger"
                            : "neutral"
                    }
                  >
                    {user.status.replaceAll("_", " ")}
                  </Badge>
                </td>
                <td className="px-4">
                  {user.lastLoginAt?.toLocaleString() ?? "Never"}
                </td>
                <td className="px-4">{user.failedLoginCount}</td>
                <td className="px-4">
                  <span>{user.createdAt.toLocaleDateString()}</span>
                  <span className="block text-xs text-muted-foreground">
                    {user.createdBy?.name ?? "Bootstrap"}
                  </span>
                </td>
                <td className="px-4">
                  <UserTableActions
                    user={{
                      id: user.id,
                      name: user.name,
                      email: user.email,
                      status: user.status,
                    }}
                    isCurrentUser={user.id === context.userId}
                    canEdit={canEdit}
                    canDisable={canDisable}
                    canDelete={canDelete}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length ? (
          <p className="p-8 text-center text-muted-foreground">
            No users match these filters.
          </p>
        ) : null}
      </div>
      <p className="text-sm text-muted-foreground">
        Showing {(page - 1) * 20 + (users.length ? 1 : 0)}–
        {(page - 1) * 20 + users.length} of {total}
      </p>
    </div>
  );
}
