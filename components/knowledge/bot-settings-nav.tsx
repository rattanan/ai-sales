"use client";

import Link from "next/link";
import {
  BarChart3,
  Bot,
  BrainCircuit,
  Gauge,
  History,
  LibraryBig,
  Network,
  PlugZap,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { useWorkspaceLocale } from "@/components/layout/workspace-locale";
import { cn } from "@/lib/utils";

const items: Array<{
  value: string;
  label: string;
  icon: LucideIcon;
}> = [
  { value: "overview", label: "Overview", icon: Gauge },
  { value: "prompt-model", label: "Prompt & Model", icon: BrainCircuit },
  { value: "sources", label: "Bot Sources", icon: LibraryBig },
  { value: "api-tools", label: "Bot API Tools", icon: PlugZap },
  { value: "appearance", label: "Appearance", icon: Bot },
  { value: "playground", label: "Playground", icon: Sparkles },
  {
    value: "embed-integration",
    label: "Embed & Integration",
    icon: Network,
  },
  {
    value: "conversation-history",
    label: "Conversation History",
    icon: History,
  },
  { value: "analytics", label: "Bot Analytics", icon: BarChart3 },
];

export function BotSettingsNav({
  botId,
  current,
}: {
  botId: string;
  current: string;
}) {
  const { t } = useWorkspaceLocale();

  return (
    <section className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 px-1 pb-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-indigo-700">
            {t("Bot settings")}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {t("Configure this bot without leaving its workspace.")}
          </p>
        </div>
      </div>
      <nav aria-label={t("Bot settings")} className="flex flex-wrap gap-1.5">
        {items.map((item) => {
          const active = current === item.value;
          const Icon = item.icon;
          const href =
            item.value === "overview"
              ? `/workspace/admin/bots/${botId}`
              : `/workspace/admin/bots/${botId}?tab=${item.value}`;
          return (
            <Link
              key={item.value}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex min-h-10 items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 motion-reduce:transition-none",
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
              )}
            >
              <Icon size={16} aria-hidden="true" />
              <span>{t(item.label)}</span>
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
