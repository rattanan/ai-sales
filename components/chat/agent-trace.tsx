"use client";

import { useState } from "react";
import {
  AlertCircle,
  Brain,
  Check,
  ChevronRight,
  Clock,
  Database,
  FileSearch,
  Globe2,
  ImageIcon,
  LoaderCircle,
  MessageSquare,
  Plug,
  Sparkles,
  Table2,
} from "lucide-react";

export type AgentTraceEntry =
  | {
      kind: "reasoning";
      step: number;
      text: string;
      done: boolean;
      /** The stored copy of this round was capped, so the tail is missing. */
      truncated?: boolean;
    }
  | {
      kind: "tool";
      step: number;
      toolCallId?: string;
      toolName: string;
      type: string;
      status: string;
      durationMs?: number;
      errorCode?: string | null;
      arguments?: Record<string, unknown> | null;
      summary?: string | null;
    };

const TOOL_LABEL: Record<string, string> = {
  search_documents: "ค้นเอกสาร",
  search_knowledge: "ค้นฐานความรู้",
  list_document_sources: "ดูรายการคลังเอกสาร",
  search_conversation_history: "ค้นบทสนทนาเก่า",
  search_business_insights: "ค้นผลวิเคราะห์ธุรกิจ",
  list_data_sources: "ดูรายการฐานข้อมูล",
  query_database: "ดึงข้อมูลจากฐานข้อมูล",
  web_search: "ค้นเว็บ",
  display_qr: "แสดง QR Code",
  display_chart: "แสดงกราฟ",
  display_image: "แสดงรูปภาพ",
  get_current_datetime: "ตรวจวันที่ปัจจุบัน",
  ntop_search: "ค้นข้อมูลใน NTOP",
  ntop_get: "อ่านรายละเอียดจาก NTOP",
  ntop_propose_prospect: "ร่าง Prospect ใน NTOP",
  ntop_propose_lead: "ร่าง Lead ใน NTOP",
  ntop_propose_opportunity: "ร่าง Opportunity ใน NTOP",
};

const GROUP_ICON: Record<
  string,
  React.ComponentType<{ size?: number; className?: string }>
> = {
  DOCUMENT: FileSearch,
  HISTORY: MessageSquare,
  INSIGHT: Table2,
  DATABASE: Database,
  API: Plug,
  NTOP: Sparkles,
  WEB: Globe2,
  DISPLAY: ImageIcon,
  PLATFORM: Clock,
};

function toolLabel(toolName: string) {
  return (
    TOOL_LABEL[toolName] ?? toolName.replace(/^api__/, "").replaceAll("_", " ")
  );
}

function duration(ms?: number) {
  if (ms === undefined) return null;
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} วิ`;
}

/** Arguments are already masked server-side, so they can be shown verbatim. */
function argumentLines(args: Record<string, unknown> | null | undefined) {
  if (!args) return [];
  return Object.entries(args)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => ({
      key,
      value: typeof value === "string" ? value : JSON.stringify(value),
    }));
}

function StatusMark({ status }: { status: string }) {
  if (status === "RUNNING")
    return (
      <LoaderCircle
        className="animate-spin text-primary motion-reduce:animate-none"
        size={14}
        aria-hidden="true"
      />
    );
  if (status === "FAILED")
    return (
      <AlertCircle className="text-amber-600" size={14} aria-hidden="true" />
    );
  return <Check className="text-emerald-600" size={14} aria-hidden="true" />;
}

function ReasoningBlock({
  round,
  text,
  streaming,
  truncated = false,
}: {
  round: number;
  text: string;
  streaming: boolean;
  truncated?: boolean;
}) {
  // Collapsed by default. An interleaved trace has several rounds, and opening
  // every one pushed the tool steps off the screen; the character count in the
  // header is enough to judge whether a round is worth reading.
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm hover:bg-violet-50/50"
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""} motion-reduce:transition-none`}
        />
        <Brain
          size={14}
          className="shrink-0 text-violet-600"
          aria-hidden="true"
        />
        <span className="font-medium">การคิด รอบ {round}</span>
        {streaming ? (
          <LoaderCircle
            className="animate-spin text-primary motion-reduce:animate-none"
            size={13}
            aria-hidden="true"
          />
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {text.length.toLocaleString("th-TH")} ตัวอักษร
          </span>
        )}
      </button>
      {open ? (
        <p className="mx-3 mb-2 max-h-60 overflow-y-auto rounded-lg bg-violet-50/70 px-3 py-2 text-xs leading-5 whitespace-pre-wrap text-violet-950">
          {text || "…"}
          {truncated ? (
            <span className="mt-1 block text-violet-700 italic">
              ตัดส่วนที่เหลือของรอบนี้ออกตอนบันทึก
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function ToolEntry({
  entry,
  defaultOpen,
}: {
  entry: Extract<AgentTraceEntry, { kind: "tool" }>;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = GROUP_ICON[entry.type] ?? Plug;
  const args = argumentLines(entry.arguments);
  const expandable = args.length > 0 || Boolean(entry.summary);
  return (
    <div>
      <button
        type="button"
        onClick={() => expandable && setOpen((value) => !value)}
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        className="flex min-h-9 w-full items-center gap-2 rounded-lg px-1 text-left text-sm hover:bg-muted/60 disabled:hover:bg-transparent"
      >
        <ChevronRight
          size={13}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""} ${expandable ? "" : "opacity-0"} motion-reduce:transition-none`}
        />
        <Icon size={14} className="shrink-0 text-muted-foreground" />
        <span className="font-medium">{toolLabel(entry.toolName)}</span>
        <StatusMark status={entry.status} />
        {duration(entry.durationMs) ? (
          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
            {duration(entry.durationMs)}
          </span>
        ) : null}
      </button>
      {entry.status === "FAILED" && entry.errorCode ? (
        <p className="mt-0.5 ml-6 text-xs text-amber-700">{entry.errorCode}</p>
      ) : null}
      {open ? (
        <div className="mt-1 ml-6 space-y-1.5">
          {args.map(({ key, value }) => (
            <p key={key} className="text-xs leading-5">
              <span className="text-muted-foreground">{key}: </span>
              <span className="break-words">{value}</span>
            </p>
          ))}
          {entry.summary ? (
            <p className="max-h-40 overflow-y-auto rounded-lg bg-muted px-3 py-2 text-xs leading-5 whitespace-pre-wrap">
              {entry.summary}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The turn's visible trace, in the order it happened: the model thinks, acts on
 * what it learned, thinks again, and eventually answers. Reasoning and tool
 * calls are therefore interleaved rather than grouped — grouping them hid which
 * thought led to which call.
 *
 * Live it stays expanded so the wait is legible; once the answer lands it
 * collapses, because the trace is supporting detail and the answer is the
 * thing being read.
 */
export function AgentTrace({
  entries,
  live = false,
}: {
  entries: AgentTraceEntry[];
  live?: boolean;
}) {
  const [open, setOpen] = useState(live);
  const shown = entries.filter(
    (entry) => entry.kind === "tool" || entry.text.trim().length > 0,
  );
  if (!shown.length) return null;

  const tools = shown.filter((entry) => entry.kind === "tool");
  const rounds = shown.length - tools.length;
  const totalMs = shown.reduce(
    (sum, entry) => sum + (entry.kind === "tool" ? (entry.durationMs ?? 0) : 0),
    0,
  );
  const failed = shown.filter(
    (entry) => entry.kind === "tool" && entry.status === "FAILED",
  ).length;
  const summary = [
    rounds ? `การคิด ${rounds} รอบ` : null,
    tools.length ? `${tools.length} ขั้นตอน` : null,
    totalMs > 0 ? duration(totalMs) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Numbered up front rather than while rendering: each kind counts in its own
  // sequence, so "รอบ 2" and step "2" stay meaningful even though they
  // alternate down the list.
  const numbered = shown.reduce<
    Array<{ entry: AgentTraceEntry; number: number }>
  >((rows, entry) => {
    const previous = rows.filter((row) => row.entry.kind === entry.kind).length;
    return [...rows, { entry, number: previous + 1 }];
  }, []);

  return (
    <section
      className="mt-2 rounded-xl border bg-white/70"
      {...(live ? { "aria-live": "polite" as const } : {})}
      aria-label="กระบวนการตอบของผู้ช่วย"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm"
      >
        <ChevronRight
          size={14}
          aria-hidden="true"
          className={`shrink-0 transition-transform ${open ? "rotate-90" : ""} motion-reduce:transition-none`}
        />
        {live ? (
          <LoaderCircle
            className="animate-spin text-primary motion-reduce:animate-none"
            size={14}
            aria-hidden="true"
          />
        ) : (
          <Sparkles
            size={14}
            className="shrink-0 text-muted-foreground"
            aria-hidden="true"
          />
        )}
        <span className="font-medium">{summary}</span>
        {failed > 0 ? (
          <span className="text-xs text-amber-700">
            {failed} รายการไม่สำเร็จ
          </span>
        ) : null}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {open ? "ย่อ" : "ดูกระบวนการ"}
        </span>
      </button>
      {open ? (
        <ol className="border-t">
          {numbered.map(({ entry, number }, index) => {
            if (entry.kind === "reasoning")
              return (
                <li key={`reasoning-${entry.step}-${index}`}>
                  <ReasoningBlock
                    round={number}
                    text={entry.text}
                    streaming={!entry.done}
                    truncated={entry.truncated}
                  />
                </li>
              );
            return (
              <li
                key={`tool-${entry.toolCallId ?? `${entry.step}-${index}`}`}
                className="flex gap-2 border-b px-3 py-1.5 last:border-b-0"
              >
                <span className="mt-1.5 w-4 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
                  {number}
                </span>
                <span className="min-w-0 flex-1">
                  <ToolEntry entry={entry} defaultOpen={false} />
                </span>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
