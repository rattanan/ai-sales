import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import {
  logoutAllSessionsAction,
  updateProfileAction,
} from "@/features/auth/actions";
import { requireAuthorization, requireUser } from "@/server/auth/authorization";
import { db } from "@/server/db";

export default async function ProfilePage() {
  const [sessionUser, context] = await Promise.all([
    requireUser(),
    requireAuthorization(),
  ]);
  const user = await db.user.findUniqueOrThrow({
    where: { id: sessionUser.id },
    include: {
      memberships: {
        where: { organizationId: context.organizationId },
        include: {
          organizationUnit: true,
          projects: { include: { project: true } },
        },
      },
      userRoles: {
        where: { organizationId: context.organizationId },
        include: { role: true },
      },
    },
  });
  const membership = user.memberships[0];
  return (
    <div className="space-y-6">
      <PageHeader
        title="Profile & security"
        description="Review your organization scope and manage account security."
      />
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Profile</h2>
          <form action={updateProfileAction} className="space-y-4">
            <Field label="Full name" htmlFor="name">
              <Input
                id="name"
                name="name"
                defaultValue={user.name ?? ""}
                required
              />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input id="email" value={user.email} disabled />
            </Field>
            <Field label="Username" htmlFor="username">
              <Input id="username" value={user.username ?? ""} disabled />
            </Field>
            <Button>Save profile</Button>
          </form>
        </div>
        <div className="rounded-xl border bg-card p-5">
          <h2 className="mb-4 font-semibold">Organization access</h2>
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-muted-foreground">Role</dt>
              <dd className="mt-1 font-medium">
                {user.userRoles.map(({ role }) => role.name).join(", ") ||
                  membership?.role ||
                  "User"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Department</dt>
              <dd className="mt-1 font-medium">
                {membership?.organizationUnit?.name ?? "Unassigned"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Projects</dt>
              <dd className="mt-1 font-medium">
                {membership?.projects
                  .map(({ project }) => project.name)
                  .join(", ") || "Unassigned"}
              </dd>
            </div>
          </dl>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Session security</h2>
        <p className="my-2 text-sm text-muted-foreground">
          Standard sessions expire after 8 hours. “Remember me” sessions expire
          after 30 days. Password resets and account locks revoke every session.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link href="/change-password">Change password</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/workspace/profile/memory">Memory & consent</Link>
          </Button>
          <form action={logoutAllSessionsAction}>
            <Button variant="destructive">Sign out all sessions</Button>
          </form>
        </div>
      </section>
    </div>
  );
}
