import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import {
  requireUser,
  getAuthorizationContext,
} from "@/server/auth/authorization";
import { db } from "@/server/db";
import { WorkspaceShell } from "@/components/layout/workspace-shell";
import { getPermissionKeys } from "@/server/auth/permissions";
import {
  isWorkspaceLocale,
  WORKSPACE_LOCALE_COOKIE,
} from "@/lib/workspace-i18n";
import {
  isSidebarCollapsed,
  WORKSPACE_SIDEBAR_COOKIE,
} from "@/lib/workspace-chrome";

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const context = await getAuthorizationContext();
  if (!context) redirect("/onboarding");
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: context.workspaceId },
    include: { organization: true },
  });
  const permissions = await getPermissionKeys(context);
  const cookieStore = await cookies();
  const savedLocale = cookieStore.get(WORKSPACE_LOCALE_COOKIE)?.value;
  const initialLocale = isWorkspaceLocale(savedLocale) ? savedLocale : "en";
  const initialSidebarCollapsed = isSidebarCollapsed(
    cookieStore.get(WORKSPACE_SIDEBAR_COOKIE)?.value,
  );
  return (
    <WorkspaceShell
      initialLocale={initialLocale}
      initialSidebarCollapsed={initialSidebarCollapsed}
      user={user}
      workspace={{
        name: workspace.name,
        organizationName: workspace.organization.name,
      }}
      navigation={{
        chat: permissions.has("chat.use"),
        botUse: permissions.has("bot.use"),
        botManagement: permissions.has("bot.manage"),
        knowledgeManagement: permissions.has("knowledge.manage"),
        dataConnections: permissions.has("datasource.update"),
        legacyApis: permissions.has("legacy_api.manage"),
        insights:
          permissions.has("insight.manage") || permissions.has("insight.view"),
        providerManagement: permissions.has("provider.manage"),
        authenticationManagement: permissions.has("organization.manage"),
        userManagement: permissions.has("user.create"),
        roleManagement: permissions.has("role.manage"),
        storageManagement: permissions.has("system.health.view"),
        workerManagement: permissions.has("knowledge.manage"),
        privacyManagement: permissions.has("privacy.manage"),
        auditAccess:
          permissions.has("audit.view") ||
          permissions.has("login_history.view"),
        systemHealth: permissions.has("system.health.view"),
      }}
    >
      {children}
    </WorkspaceShell>
  );
}
