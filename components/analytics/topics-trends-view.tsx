"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Topic = { topic: string; count: number };
type Trend = {
  date: string;
  messages: number;
  errors: number;
  averageLatencyMs: number;
};

export function TopicsTrendsView({
  topics,
  trends,
  questionCount,
  reprocessed,
}: {
  topics: Topic[];
  trends: Trend[];
  questionCount: number;
  reprocessed: boolean;
}) {
  const topTopic = topics[0];
  const maxCount = Math.max(...topics.map(({ count }) => count), 1);
  const peak = trends.reduce<Trend | null>(
    (current, item) =>
      !current || item.messages > current.messages ? item : current,
    null,
  );

  return (
    <div className="mt-5 space-y-5">
      {reprocessed ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950">
          Topics from this legacy snapshot were reprocessed with the current
          Thai/English phrase analyzer. Create a new snapshot to persist the
          improved topics and daily trend data.
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <SummaryCard
          label="Leading topic"
          value={topTopic?.topic ?? "No stable topic"}
          detail={topTopic ? `${topTopic.count} questions` : "Not enough data"}
        />
        <SummaryCard
          label="Questions analyzed"
          value={questionCount.toLocaleString()}
          detail={`${topics.length} stable topic${topics.length === 1 ? "" : "s"}`}
        />
        <SummaryCard
          label="Peak activity"
          value={peak ? `${peak.messages} messages` : "Unavailable"}
          detail={peak?.date ?? "Generate a new snapshot"}
        />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
        <section className="rounded-xl border bg-background p-5">
          <div>
            <h3 className="font-semibold">Topic distribution</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Repeated subjects ranked by the number of distinct questions.
            </p>
          </div>
          {topics.length ? (
            <ol className="mt-5 space-y-4">
              {topics.map((topic, index) => {
                const share = questionCount
                  ? Math.round((topic.count / questionCount) * 100)
                  : 0;
                return (
                  <li key={topic.topic}>
                    <div className="flex items-baseline justify-between gap-4 text-sm">
                      <span className="min-w-0 truncate font-medium">
                        {index + 1}. {topic.topic}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {topic.count} · {share}%
                      </span>
                    </div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-indigo-100">
                      <div
                        className="h-full rounded-full bg-indigo-600"
                        style={{ width: `${(topic.count / maxCount) * 100}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <EmptyState message="No repeated topic was strong enough to report." />
          )}
        </section>

        <section className="rounded-xl border bg-background p-5">
          <div>
            <h3 className="font-semibold">Activity and response trend</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Daily message volume, errors, and average response latency.
            </p>
          </div>
          {trends.length ? (
            <>
              <div
                className="mt-5 h-80"
                role="img"
                aria-label="Daily message volume, errors, and average response latency"
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={trends}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} />
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="count" allowDecimals={false} />
                    <YAxis
                      yAxisId="latency"
                      orientation="right"
                      tickFormatter={(value: number) => `${value} ms`}
                      width={72}
                    />
                    <Tooltip />
                    <Legend />
                    <Bar
                      yAxisId="count"
                      dataKey="messages"
                      name="Messages"
                      fill="#4f46e5"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      yAxisId="count"
                      dataKey="errors"
                      name="Errors"
                      fill="#dc2626"
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      yAxisId="latency"
                      type="monotone"
                      dataKey="averageLatencyMs"
                      name="Average latency"
                      stroke="#059669"
                      strokeWidth={2}
                      dot
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <ul className="sr-only">
                {trends.map((trend) => (
                  <li key={trend.date}>
                    {trend.date}: {trend.messages} messages, {trend.errors}{" "}
                    errors, {trend.averageLatencyMs} milliseconds average
                    latency
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <EmptyState message="This legacy snapshot has no daily trend data. Generate a new snapshot to see the chart." />
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-xl border bg-background p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 truncate text-xl font-semibold" title={value}>
        {value}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="mt-5 grid min-h-64 place-items-center rounded-lg border border-dashed px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
