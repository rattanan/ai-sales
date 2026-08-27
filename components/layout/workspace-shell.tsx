"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Languages,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck,
} from "lucide-react";
import { WorkspaceNav } from "./workspace-nav";
import {
  useWorkspaceLocale,
  WorkspaceLocaleProvider,
} from "./workspace-locale";
import { logoutAction } from "@/features/auth/actions";
import {
  InsightKmMark,
  InsightKmWordmark,
} from "@/components/brand/insightkm-mark";
import type { NavigationAccess } from "./workspace-nav";
import { APP_VERSION, type WorkspaceLocale } from "@/lib/workspace-i18n";
import {
  isChatSurface,
  WORKSPACE_SIDEBAR_COOKIE,
} from "@/lib/workspace-chrome";
import { WorkspaceMobileChromeProvider } from "./workspace-mobile-chrome";
import { cn } from "@/lib/utils";

type WorkspaceShellProps = {
  children: React.ReactNode;
  initialLocale: WorkspaceLocale;
  initialSidebarCollapsed: boolean;
  workspace: { name: string; organizationName: string };
  user: { name?: string | null; email?: string | null };
  navigation: NavigationAccess;
};

export function WorkspaceShell({
  children,
  initialLocale,
  initialSidebarCollapsed,
  workspace,
  user,
  navigation,
}: WorkspaceShellProps) {
  return (
    <WorkspaceLocaleProvider initialLocale={initialLocale}>
      <WorkspaceShellContent
        initialSidebarCollapsed={initialSidebarCollapsed}
        workspace={workspace}
        user={user}
        navigation={navigation}
      >
        {children}
      </WorkspaceShellContent>
    </WorkspaceLocaleProvider>
  );
}

function WorkspaceShellContent({
  children,
  initialSidebarCollapsed,
  workspace,
  user,
  navigation,
}: Omit<WorkspaceShellProps, "initialLocale">) {
  const { locale, setLocale, t } = useWorkspaceLocale();
  const fullBleed = isChatSurface(usePathname());
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    initialSidebarCollapsed,
  );

  function toggleSidebar() {
    const collapsed = !sidebarCollapsed;
    setSidebarCollapsed(collapsed);
    // Same shape as the locale cookie: the server reads it on the next request,
    // so the rail comes back already collapsed instead of snapping shut.
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    document.cookie = `${WORKSPACE_SIDEBAR_COOKIE}=${collapsed ? "collapsed" : "expanded"}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  }
  const sidebarToggleLabel = t(
    sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar",
  );
  const initials = (user.name || user.email || "U")
    .split(/\s|@/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
  const languageLabel = t(
    locale === "en" ? "Switch to Thai" : "Switch to English",
  );
  function switchLocale() {
    setLocale(locale === "en" ? "th" : "en");
  }

  // The two controls a phone needs from the shell. Below `lg` a chat screen
  // shows them in its own header instead of this bar, so they are built once
  // here and handed over through context. The popovers carry z-40 because a
  // page header may sit above a floating composer.
  const mobileNav = (
    <details className="relative">
      <summary
        className="grid size-11 cursor-pointer list-none place-items-center rounded-lg border"
        aria-label={t("Open navigation")}
      >
        <Menu size={20} />
      </summary>
      <div className="absolute left-0 top-13 z-40 max-h-[calc(100dvh-6rem)] w-[min(22rem,calc(100vw-2rem))] overflow-y-auto rounded-xl border bg-card p-3 shadow-xl">
        <p className="px-3 pb-3 text-sm font-semibold">{workspace.name}</p>
        <WorkspaceNav mobile {...navigation} />
      </div>
    </details>
  );
  function renderUserMenu(compact: boolean) {
    return (
      <details className="relative">
        <summary
          aria-label={t("Account menu")}
          className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg px-2 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        >
          <span className="grid size-8 place-items-center rounded-full bg-slate-900 text-xs font-semibold text-white">
            {initials}
          </span>
          {compact ? null : (
            <>
              <span className="hidden max-w-40 truncate text-sm font-medium sm:block">
                {user.name || user.email}
              </span>
              <ChevronDown size={15} aria-hidden="true" />
            </>
          )}
        </summary>
        <div className="absolute right-0 top-12 z-40 w-56 rounded-xl border bg-card p-2 shadow-xl">
          <div className="border-b px-3 py-2">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="truncate text-xs text-muted-foreground">
              {user.email}
            </p>
          </div>
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
            <ShieldCheck size={14} aria-hidden="true" />
            {t("Governed access")}
          </div>
          {/* The compact bar has no room for the language toggle, so the
              menu offers it instead. */}
          {compact ? (
            <button
              type="button"
              onClick={switchLocale}
              className="flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-sm hover:bg-muted"
            >
              <Languages size={15} aria-hidden="true" />
              {languageLabel}
            </button>
          ) : null}
          <Link
            href="/workspace/profile"
            className="block min-h-10 rounded-lg px-3 py-2.5 text-sm hover:bg-muted"
          >
            {t("Profile & security")}
          </Link>
          <form action={logoutAction} className="mt-2">
            <button className="min-h-10 w-full cursor-pointer rounded-lg px-3 text-left text-sm hover:bg-muted">
              {t("Sign out")}
            </button>
          </form>
        </div>
      </details>
    );
  }
  return (
    <WorkspaceMobileChromeProvider
      value={fullBleed ? { start: mobileNav, end: renderUserMenu(true) } : null}
    >
      <div
        className={cn(
          "min-h-dvh bg-background lg:grid lg:transition-[grid-template-columns] lg:duration-200 motion-reduce:transition-none",
          sidebarCollapsed
            ? "lg:grid-cols-[76px_minmax(0,1fr)]"
            : "lg:grid-cols-[272px_minmax(0,1fr)]",
        )}
      >
        <a
          href="#main-content"
          className="sr-only fixed left-4 top-4 z-50 rounded-lg bg-slate-950 px-4 py-3 text-sm font-medium text-white focus:not-sr-only"
        >
          {t("Skip to main content")}
        </a>
        <aside
          id="workspace-sidebar"
          className={cn(
            // z-40: `fixed` is its own stacking context, so the edge button can
            // only clear the sticky content header (z-30) if the aside does.
            "hidden border-r bg-card transition-[width] duration-200 motion-reduce:transition-none lg:fixed lg:inset-y-0 lg:z-40 lg:flex lg:flex-col",
            sidebarCollapsed ? "lg:w-[76px]" : "lg:w-[272px]",
          )}
        >
          {/* Sits astride the border in line with the header row, where readers
            of most desktop apps expect the collapse control. 28px visually, a
            44px hit area underneath. */}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarToggleLabel}
            title={sidebarToggleLabel}
            className="absolute -right-3.5 top-[26px] grid size-7 cursor-pointer place-items-center rounded-full border bg-card text-slate-500 shadow-sm transition-colors before:absolute before:-inset-2 before:content-[''] hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {sidebarCollapsed ? (
              <ChevronRight size={14} aria-hidden="true" />
            ) : (
              <ChevronLeft size={14} aria-hidden="true" />
            )}
          </button>
          <div
            className={cn(
              "flex h-20 shrink-0 items-center border-b",
              sidebarCollapsed ? "justify-center px-3" : "px-5",
            )}
          >
            <Link
              href="/workspace"
              className="flex items-center gap-3"
              title={sidebarCollapsed ? "AI-Sales" : undefined}
            >
              <InsightKmMark />
              {sidebarCollapsed ? null : <InsightKmWordmark />}
            </Link>
          </div>
          <div
            className={cn(
              "min-h-0 flex-1 overflow-y-auto",
              sidebarCollapsed ? "p-3" : "p-4 [scrollbar-gutter:stable]",
            )}
          >
            {sidebarCollapsed ? null : (
              <div className="mb-5 rounded-xl border bg-[linear-gradient(135deg,#ffffff,#fff8cf)] p-3.5">
                <p className="truncate text-xs font-medium text-muted-foreground">
                  {workspace.organizationName}
                </p>
                <p className="mt-1 truncate text-sm font-semibold">
                  {workspace.name}
                </p>
                <div className="mt-3 flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                  <span className="size-1.5 rounded-full bg-emerald-500" />
                  {t("Knowledge workspace active")}
                </div>
              </div>
            )}
            <WorkspaceNav collapsed={sidebarCollapsed} {...navigation} />
          </div>
          <div
            className={cn(
              "shrink-0 border-t",
              sidebarCollapsed ? "p-3" : "p-4",
            )}
          >
            <button
              type="button"
              onClick={toggleSidebar}
              aria-expanded={!sidebarCollapsed}
              aria-label={sidebarToggleLabel}
              title={sidebarToggleLabel}
              className={cn(
                "flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                sidebarCollapsed && "justify-center px-0",
              )}
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen size={18} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} aria-hidden="true" />
              )}
              {sidebarCollapsed ? null : <span>{t("Collapse sidebar")}</span>}
            </button>
          </div>
        </aside>
        {/* A chat screen owns exactly one viewport: the column is locked to the
          window height so the transcript, not the document, is what scrolls. */}
        <div
          className={`flex min-w-0 flex-col lg:col-start-2 ${fullBleed ? "h-dvh" : "min-h-dvh"}`}
        >
          {/* A chat screen below lg hosts the two mobile controls in its own
            header, so this bar would only duplicate them. */}
          <header
            className={cn(
              "sticky top-0 z-30 flex h-20 shrink-0 items-center justify-between border-b bg-white/90 px-4 backdrop-blur-xl sm:px-7",
              fullBleed && "max-lg:hidden",
            )}
          >
            <div className="lg:hidden">{mobileNav}</div>
            <div className="hidden lg:block">
              <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                {t("Knowledge workspace")}
              </p>
              <p className="mt-0.5 text-sm font-semibold">{workspace.name}</p>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <button
                type="button"
                onClick={switchLocale}
                aria-label={languageLabel}
                title={languageLabel}
                className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
              >
                <Languages size={17} aria-hidden="true" />
                <span>{locale === "en" ? "ไทย" : "EN"}</span>
              </button>
              {renderUserMenu(false)}
            </div>
          </header>
          <main
            id="main-content"
            className={`w-full min-w-0 flex-1 ${fullBleed ? "flex min-h-0 flex-1 flex-col pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] pr-[env(safe-area-inset-right)] sm:p-4" : "mx-auto max-w-[1500px] p-5 sm:p-7 lg:p-9"}`}
          >
            {children}
          </main>
          {/* A locked-height screen has nothing to scroll to, so the footer would
            only sit just below the fold. Its version string stays reachable on
            every other page. */}
          <footer
            hidden={fullBleed}
            className="border-t bg-white/70 px-5 py-4 text-xs text-muted-foreground sm:px-7 lg:px-9"
          >
            <div className="mx-auto flex w-full max-w-[1500px] flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p>
                © {new Date().getFullYear()} AI-Sales.{" "}
                {t("All rights reserved.")}
              </p>
              <p>
                {t("Version")} {APP_VERSION}
              </p>
            </div>
          </footer>
        </div>
      </div>
    </WorkspaceMobileChromeProvider>
  );
}
