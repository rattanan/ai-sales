type BotPerformance = {
  bot: string;
  total: number;
  errors: number;
  negative: number;
  successRate: number;
  averageLatencyMs: number;
};

type SourcePerformance = {
  source: string;
  citedResponses: number;
  negative: number;
  healthyRate: number;
};

export function BotPerformanceView({ items }: { items: BotPerformance[] }) {
  if (!items.length)
    return (
      <EmptyPerformanceState message="No assistant responses were recorded in this snapshot." />
    );
  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {items.map((item) => (
        <article key={item.bot} className="rounded-xl border bg-background p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Bot
              </p>
              <h3 className="mt-1 font-semibold">{item.bot}</h3>
            </div>
            <p className="text-2xl font-semibold text-emerald-700">
              {Math.round(item.successRate * 100)}%
            </p>
          </div>
          <p className="mt-1 text-right text-xs text-muted-foreground">
            successful responses
          </p>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full bg-emerald-600"
              style={{ width: `${item.successRate * 100}%` }}
            />
          </div>
          <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <Metric label="Responses" value={item.total} />
            <Metric label="Errors" value={item.errors} />
            <Metric label="Negative" value={item.negative} />
            <Metric label="Avg latency" value={`${item.averageLatencyMs} ms`} />
          </dl>
        </article>
      ))}
    </div>
  );
}

export function SourcePerformanceView({
  items,
}: {
  items: SourcePerformance[];
}) {
  if (!items.length)
    return (
      <EmptyPerformanceState message="No source citations were recorded in this snapshot. Generate a new snapshot after grounded answers include document, database, or API citations." />
    );
  const visibleItems = items.slice(0, 12);
  const maximum = Math.max(
    ...visibleItems.map(({ citedResponses }) => citedResponses),
  );
  return (
    <div className="mt-5 rounded-xl border bg-background p-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h3 className="font-semibold">Sources used in answers</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Ranked by distinct assistant responses that cited each source.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          Showing {visibleItems.length} of {items.length}
        </p>
      </div>
      <ol className="mt-5 divide-y">
        {visibleItems.map((item, index) => (
          <li key={item.source} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline justify-between gap-3">
              <p className="font-medium">
                {index + 1}. {item.source}
              </p>
              <p className="text-sm text-muted-foreground">
                {item.citedResponses} cited responses · {item.negative} negative
              </p>
            </div>
            <div className="mt-2 flex items-center gap-3">
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-indigo-100">
                <div
                  className="h-full rounded-full bg-indigo-600"
                  style={{
                    width: `${(item.citedResponses / maximum) * 100}%`,
                  }}
                />
              </div>
              <span className="w-14 text-right text-xs font-medium text-emerald-700">
                {Math.round(item.healthyRate * 100)}% OK
              </span>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-muted p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-semibold">{value}</dd>
    </div>
  );
}

function EmptyPerformanceState({ message }: { message: string }) {
  return (
    <div className="mt-5 grid min-h-52 place-items-center rounded-xl border border-dashed bg-background px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}
