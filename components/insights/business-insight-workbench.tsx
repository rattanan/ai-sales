"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { createBusinessInsightAction } from "@/features/insights/business-actions";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type Choice = { id: string; name: string };
export function BusinessInsightForm({
  bots,
  departments,
  projects,
  users,
}: {
  bots: Choice[];
  departments: Choice[];
  projects: Choice[];
  users: Choice[];
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState(
    createBusinessInsightAction,
    null,
  );
  useEffect(() => {
    if (state?.ok) router.push(`/workspace/insights?id=${state.data.id}`);
  }, [router, state]);
  const today = new Date();
  const from = new Date(today);
  from.setDate(today.getDate() - 29);
  const dateValue = (value: Date) => value.toISOString().slice(0, 10);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <Field label="From" htmlFor="insight-date-from" required>
        <Input
          id="insight-date-from"
          name="dateFrom"
          type="date"
          defaultValue={dateValue(from)}
          required
        />
      </Field>
      <Field label="To" htmlFor="insight-date-to" required>
        <Input
          id="insight-date-to"
          name="dateTo"
          type="date"
          defaultValue={dateValue(today)}
          required
        />
      </Field>
      {[
        ["botId", "Bot", bots],
        ["organizationUnitId", "Department", departments],
        ["projectId", "Project", projects],
        ["userId", "User", users],
      ].map(([name, label, choices]) => (
        <Field
          key={String(name)}
          label={String(label)}
          htmlFor={`insight-${name}`}
        >
          <select
            id={`insight-${name}`}
            name={String(name)}
            className="min-h-11 w-full rounded-lg border bg-background px-3"
          >
            <option value="">All within my permitted scope</option>
            {(choices as Choice[]).map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.name}
              </option>
            ))}
          </select>
        </Field>
      ))}
      <div className="space-y-3 md:col-span-2 xl:col-span-3">
        {state ? (
          <p
            role={state.ok ? "status" : "alert"}
            aria-live="polite"
            className={
              state.ok ? "text-sm text-emerald-700" : "text-sm text-red-700"
            }
          >
            {state.ok
              ? "Insight analysis queued in the worker."
              : state.error.message}
          </p>
        ) : null}
        <Button disabled={pending}>
          {pending
            ? "Queueing permitted conversations…"
            : "Run business insight"}
        </Button>
      </div>
    </form>
  );
}

export function BusinessInsightStatusRefresh({
  status,
}: {
  status: string | null;
}) {
  const router = useRouter();

  useEffect(() => {
    if (status !== "PROCESSING") return;
    const interval = window.setInterval(() => router.refresh(), 2_000);
    return () => window.clearInterval(interval);
  }, [router, status]);

  return null;
}

type InsightDashboardProps = {
  metrics: {
    conversationCount: number;
    messageCount: number;
    errorCount: number;
    errorRate: number;
    negativeFeedbackCount: number;
    averageLatencyMs: number;
    p95LatencyMs: number;
  };
  trends: Array<{
    date: string;
    messages: number;
    errors: number;
    averageLatencyMs: number;
  }>;
  topics: Array<{ topic: string; count: number }>;
  knowledgeGaps: {
    count: number;
    items: Array<{ topic: string; count: number }>;
  };
  findings: Array<{
    type: string;
    title: string;
    statement: string;
    evidenceCount: number;
  }>;
  limitations: string[];
};

export function BusinessInsightDashboard({
  metrics,
  trends,
  topics,
  knowledgeGaps,
  findings,
  limitations,
}: InsightDashboardProps) {
  const cards = [
    ["Conversations", metrics.conversationCount],
    ["Messages", metrics.messageCount],
    ["Error rate", `${Math.round(metrics.errorRate * 100)}%`],
    ["Negative feedback", metrics.negativeFeedbackCount],
    ["Average latency", `${metrics.averageLatencyMs} ms`],
    ["p95 latency", `${metrics.p95LatencyMs} ms`],
  ];
  return (
    <div className="space-y-6">
      {limitations.length ? (
        <div
          role="status"
          className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        >
          {limitations.map((limitation) => (
            <p key={limitation}>{limitation}</p>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {cards.map(([label, value]) => (
          <div key={String(label)} className="rounded-xl border bg-card p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold">Message, error, and latency trend</h3>
        {trends.length ? (
          <div
            className="mt-4 h-80"
            role="img"
            aria-label="Daily messages, errors, and average latency trend"
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trends}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="count" allowDecimals={false} />
                <YAxis yAxisId="latency" orientation="right" unit=" ms" />
                <Tooltip />
                <Legend />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="messages"
                  stroke="#4f46e5"
                  strokeWidth={2}
                  dot
                />
                <Line
                  yAxisId="count"
                  type="monotone"
                  dataKey="errors"
                  stroke="#dc2626"
                  strokeWidth={2}
                  dot
                />
                <Line
                  yAxisId="latency"
                  type="monotone"
                  dataKey="averageLatencyMs"
                  stroke="#059669"
                  strokeWidth={2}
                  dot
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="mt-4 grid min-h-48 place-items-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
            This snapshot has no daily trend data. Create a new snapshot to
            generate the chart.
          </div>
        )}
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">Top topics</h3>
          <ol className="mt-4 space-y-3">
            {topics.map((topic, index) => (
              <li
                key={topic.topic}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>
                  {index + 1}. {topic.topic}
                </span>
                <span className="rounded-full bg-indigo-50 px-2 py-1 font-medium text-indigo-700">
                  {topic.count}
                </span>
              </li>
            ))}
            {!topics.length ? (
              <li className="text-sm text-muted-foreground">
                No stable topic signal.
              </li>
            ) : null}
          </ol>
        </section>
        <section className="rounded-xl border bg-card p-5">
          <h3 className="font-semibold">Knowledge gaps</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {knowledgeGaps.count} grounded-context gaps in this sample.
          </p>
          <ul className="mt-4 space-y-3">
            {knowledgeGaps.items.map((gap) => (
              <li
                key={gap.topic}
                className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950"
              >
                {gap.topic} · {gap.count} occurrence{gap.count === 1 ? "" : "s"}
              </li>
            ))}
            {!knowledgeGaps.items.length ? (
              <li className="text-sm text-muted-foreground">
                No classified gaps.
              </li>
            ) : null}
          </ul>
        </section>
      </div>
      <section className="rounded-xl border bg-card p-5">
        <h3 className="font-semibold">
          Risks, opportunities, and recommendations
        </h3>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          {findings.map((finding) => (
            <article
              key={`${finding.type}-${finding.title}`}
              className="rounded-xl border p-4"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">
                {finding.type.replaceAll("_", " ")}
              </p>
              <h4 className="mt-1 font-medium">{finding.title}</h4>
              <p className="mt-2 text-sm text-muted-foreground">
                {finding.statement}
              </p>
              <p className="mt-3 text-xs">
                Evidence aggregate: {finding.evidenceCount} message/conversation
                records
              </p>
            </article>
          ))}
          {!findings.length ? (
            <p className="text-sm text-muted-foreground">
              No conclusions are generated until the minimum evidence threshold
              is met.
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
