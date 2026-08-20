"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity,
  Bot,
  BookOpenCheck,
  BrainCircuit,
  ChartNoAxesCombined,
  ChevronDown,
  ClipboardList,
  DatabaseZap,
  FolderTree,
  Gauge,
  House,
  LibraryBig,
  LockKeyhole,
  MessageCirclePlus,
  MessagesSquare,
  Network,
  PlugZap,
  ScrollText,
  ServerCog,
  ShieldCheck,
  Store,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorkspaceLocale } from "./workspace-locale";

type NavigationAccess = {
  chat: boolean;
  botUse: boolean;
  botManagement: boolean;
  knowledgeManagement: boolean;
  dataConnections: boolean;
  legacyApis: boolean;
  insights: boolean;
  providerManagement: boolean;
  authenticationManagement: boolean;
  userManagement: boolean;
  roleManagement: boolean;
  storageManagement: boolean;
  workerManagement: boolean;
  privacyManagement: boolean;
  auditAccess: boolean;
  systemHealth: boolean;
};

type NavigationItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  show?: keyof NavigationAccess;
  showAny?: Array<keyof NavigationAccess>;
  hideWhen?: keyof NavigationAccess;
  exact?: boolean;
  activePrefixes?: string[];
  query?: { key: string; value: string };
  excludeQueryKeys?: string[];
};

const groups: Array<{ label: string; items: NavigationItem[] }> = [
  {
    label: "Dashboard",
    items: [
      {
        href: "/workspace",
        label: "Dashboard",
        icon: House,
        exact: true,
      },
    ],
  },
  {
    label: "Chat",
    items: [
      {
        href: "/workspace/chat",
        label: "New Chat",
        icon: MessageCirclePlus,
        show: "chat",
        exact: true,
      },
      {
        href: "/workspace/chat/conversations",
        label: "Conversations",
        icon: MessagesSquare,
        show: "chat",
        exact: true,
      },
      {
        href: "/workspace/chat/saved",
        label: "Saved Answers",
        icon: BookOpenCheck,
        show: "chat",
        exact: true,
      },
    ],
  },
  {
    label: "Sources",
    items: [
      {
        href: "/workspace/admin/knowledge",
        label: "All knowledge",
        icon: FolderTree,
        show: "knowledgeManagement",
        activePrefixes: ["/workspace/admin/knowledge/sources"],
      },
      {
        href: "/workspace/admin/knowledge/access",
        label: "Knowledge Access",
        icon: LockKeyhole,
        show: "knowledgeManagement",
        exact: true,
      },
      {
        href: "/workspace/sources/database",
        label: "Database Connections",
        icon: DatabaseZap,
        show: "dataConnections",
        exact: true,
      },
      {
        href: "/workspace/sources/api-tools",
        label: "API Tools",
        icon: PlugZap,
        show: "legacyApis",
      },
    ],
  },
  {
    label: "Bots",
    items: [
      {
        href: "/workspace/bots",
        label: "Bots",
        icon: Bot,
        show: "botUse",
        hideWhen: "botManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/bots",
        label: "Bots",
        icon: Bot,
        show: "botManagement",
        activePrefixes: ["/workspace/admin/bots"],
      },
    ],
  },
  {
    label: "Analytics",
    items: [
      {
        href: "/workspace/analytics/overview",
        label: "Overview",
        icon: Gauge,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/business-insight",
        label: "Business Insight",
        icon: BrainCircuit,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/topics",
        label: "Topics & Trends",
        icon: ChartNoAxesCombined,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/unanswered",
        label: "Unanswered Questions",
        icon: MessagesSquare,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/knowledge-gaps",
        label: "Knowledge Gaps",
        icon: LibraryBig,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/bot-performance",
        label: "Bot Performance",
        icon: Activity,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/source-performance",
        label: "Source Performance",
        icon: DatabaseZap,
        show: "insights",
        exact: true,
      },
      {
        href: "/workspace/analytics/reports",
        label: "Reports",
        icon: ClipboardList,
        show: "insights",
        exact: true,
      },
    ],
  },
  {
    label: "System Admin",
    items: [
      {
        href: "/workspace/admin",
        label: "Overview",
        icon: Gauge,
        show: "userManagement",
        exact: true,
      },
      {
        href: "/workspace/sources",
        label: "Manage Source",
        icon: LibraryBig,
        showAny: ["knowledgeManagement", "dataConnections", "legacyApis"],
        exact: true,
      },
      {
        href: "/workspace/admin/chat-endpoint",
        label: "Chat AI Endpoint",
        icon: BrainCircuit,
        show: "providerManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/embedding-endpoint",
        label: "Embedding Endpoint",
        icon: DatabaseZap,
        show: "providerManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/authentication",
        label: "Authentication",
        icon: LockKeyhole,
        show: "authenticationManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/users",
        label: "Users",
        icon: UsersRound,
        show: "userManagement",
      },
      {
        href: "/workspace/admin/roles",
        label: "Roles",
        icon: ShieldCheck,
        show: "roleManagement",
      },
      {
        href: "/workspace/admin/storage",
        label: "Storage",
        icon: Store,
        show: "storageManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/knowledge/index-jobs",
        label: "Worker & Queue",
        icon: ServerCog,
        show: "workerManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/privacy",
        label: "PDPA & Masking",
        icon: ShieldCheck,
        show: "privacyManagement",
        exact: true,
      },
      {
        href: "/workspace/admin/audit-logs",
        label: "Logs & Audit",
        icon: ScrollText,
        show: "auditAccess",
        activePrefixes: [
          "/workspace/admin/audit-logs",
          "/workspace/admin/login-history",
        ],
      },
      {
        href: "/workspace/admin/system-health",
        label: "System Health",
        icon: Activity,
        show: "systemHealth",
        exact: true,
      },
      {
        href: "/workspace/admin/scopes",
        label: "Scopes",
        icon: Network,
        show: "authenticationManagement",
      },
      {
        href: "/workspace/admin/access-simulator",
        label: "Access Simulator",
        icon: LockKeyhole,
        show: "roleManagement",
        exact: true,
      },
    ],
  },
];

function matchesPath(
  pathname: string,
  searchParams: URLSearchParams,
  item: NavigationItem,
) {
  const itemPath = item.href.split(/[?#]/, 1)[0];
  if (item.query && searchParams.get(item.query.key) !== item.query.value)
    return false;
  if (item.excludeQueryKeys?.some((key) => searchParams.has(key))) return false;
  if (pathname === itemPath) return true;
  if (item.exact) return false;
  const prefixes = item.activePrefixes ?? [itemPath];
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function CollapsibleNavigationGroup({
  active,
  children,
  label,
  mobile,
}: {
  active: boolean;
  children: ReactNode;
  label: string;
  mobile: boolean;
}) {
  const [manuallyOpen, setManuallyOpen] = useState(false);
  const open = active || manuallyOpen;

  return (
    <details
      className="group/nav"
      open={open}
      onToggle={(event) => {
        if (!active) setManuallyOpen(event.currentTarget.open);
      }}
    >
      <summary
        onClick={(event) => {
          if (active && open) event.preventDefault();
        }}
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center justify-between rounded-xl px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden",
          active
            ? "text-indigo-700 hover:bg-indigo-50"
            : "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
        )}
      >
        <span>{label}</span>
        <ChevronDown
          size={16}
          className="shrink-0 transition-transform group-open/nav:rotate-180 motion-reduce:transition-none"
          aria-hidden="true"
        />
      </summary>
      <div
        className={cn(
          "mt-1 space-y-1 border-l border-slate-200 pl-2",
          mobile && "grid grid-cols-2 gap-1.5 space-y-0 border-l-0 pl-0",
        )}
      >
        {children}
      </div>
    </details>
  );
}

export function WorkspaceNav({
  mobile = false,
  ...access
}: NavigationAccess & { mobile?: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { t } = useWorkspaceLocale();
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter(
        (item) =>
          (!item.show || access[item.show]) &&
          (!item.showAny || item.showAny.some((key) => access[key])) &&
          (!item.hideWhen || !access[item.hideWhen]),
      ),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <nav aria-label={t("Main navigation")} className="space-y-2">
      {visibleGroups.map((group) => {
        const groupActive = group.items.some((item) =>
          matchesPath(pathname, searchParams, item),
        );
        const itemLinks = group.items.map((item) => {
          const active = matchesPath(pathname, searchParams, item);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex min-h-11 items-center gap-3 rounded-xl px-3 py-2 text-sm font-medium leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                active
                  ? "bg-indigo-50 text-indigo-950 shadow-[inset_3px_0_0_#4f46e5]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
              )}
            >
              <Icon
                size={18}
                className={cn(
                  "shrink-0 text-slate-400 transition-colors group-hover:text-slate-700",
                  active && "text-indigo-600 group-hover:text-indigo-600",
                )}
                aria-hidden="true"
              />
              <span>{t(item.label)}</span>
            </Link>
          );
        });

        if (group.label === "Dashboard") {
          return <div key={group.label}>{itemLinks}</div>;
        }

        return (
          <CollapsibleNavigationGroup
            key={group.label}
            label={t(group.label)}
            active={groupActive}
            mobile={mobile}
          >
            {itemLinks}
          </CollapsibleNavigationGroup>
        );
      })}
    </nav>
  );
}

export type { NavigationAccess };
