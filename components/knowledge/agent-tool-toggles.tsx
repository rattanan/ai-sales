"use client";

import { useState } from "react";
import {
  CheckCircle2,
  Clock,
  Database,
  FileSearch,
  Globe2,
  MessageSquare,
  MinusCircle,
  Table2,
} from "lucide-react";
import {
  AGENT_TOOL_CATALOG,
  AGENT_TOOL_GROUP_LABEL,
  AGENT_TOOL_GROUP_ORDER,
  type AgentToolGroupKey,
} from "@/lib/agent-tool-catalog";

const GROUP_ICON: Record<
  AgentToolGroupKey,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  DOCUMENT: FileSearch,
  HISTORY: MessageSquare,
  INSIGHT: Table2,
  DATABASE: Database,
  WEB: Globe2,
  PLATFORM: Clock,
};

/**
 * Per-tool switches for one bot. The form posts the names that are OFF, so a
 * tool added to the platform later is enabled by default rather than silently
 * disabled for every existing bot.
 */
export function AgentToolToggles({
  disabledTools = [],
}: {
  disabledTools?: string[];
}) {
  const [disabled, setDisabled] = useState(new Set(disabledTools));
  const enabledCount = AGENT_TOOL_CATALOG.length - disabled.size;

  function toggle(name: string) {
    setDisabled((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section className="rounded-xl border bg-white p-4">
      {/* One hidden input per disabled tool keeps this a plain form field. */}
      {[...disabled].map((name) => (
        <input key={name} type="hidden" name="disabledTools" value={name} />
      ))}
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">เครื่องมือของ Agent</h3>
        <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-secondary-foreground tabular-nums">
          {enabledCount}/{AGENT_TOOL_CATALOG.length} เปิดใช้
        </span>
      </header>
      <p className="mt-1 text-sm text-muted-foreground">
        เครื่องมือที่ปิดจะไม่ถูกส่งให้โมเดลและเรียกใช้ไม่ได้เลย
      </p>
      <div className="mt-4 space-y-5">
        {AGENT_TOOL_GROUP_ORDER.map((group) => {
          const tools = AGENT_TOOL_CATALOG.filter(
            (tool) => tool.group === group,
          );
          if (!tools.length) return null;
          const Icon = GROUP_ICON[group];
          return (
            <div key={group}>
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {AGENT_TOOL_GROUP_LABEL[group]}
              </h4>
              <ul className="mt-2 space-y-2">
                {tools.map((tool) => {
                  const off = disabled.has(tool.name);
                  return (
                    <li key={tool.name}>
                      <button
                        type="button"
                        onClick={() => toggle(tool.name)}
                        aria-pressed={!off}
                        className={`flex min-h-16 w-full items-center gap-3 rounded-xl border px-3 py-2 text-left ${off ? "bg-muted/50" : "bg-white"}`}
                      >
                        <span
                          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ${off ? "bg-muted text-muted-foreground" : "bg-secondary text-secondary-foreground"}`}
                        >
                          <Icon size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block font-semibold ${off ? "text-muted-foreground" : ""}`}
                          >
                            {tool.label}
                          </span>
                          <code className="block truncate text-xs text-muted-foreground">
                            {tool.name}
                          </code>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {tool.description}
                          </span>
                        </span>
                        <span
                          className={`inline-flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-semibold ${off ? "bg-muted text-muted-foreground" : "bg-emerald-50 text-emerald-700"}`}
                        >
                          {off ? (
                            <MinusCircle size={14} aria-hidden="true" />
                          ) : (
                            <CheckCircle2 size={14} aria-hidden="true" />
                          )}
                          {off ? "ปิด" : "เปิดใช้"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
