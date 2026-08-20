import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { getSystemHealth } from "@/server/services/system-health";

export const dynamic = "force-dynamic";

export default async function SystemHealthPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "system.health.view");
  const health = await getSystemHealth(context.organizationId);
  const checks = [
    ["Application", health.platform.checks.application],
    ["Database", health.platform.checks.database],
    ["Redis", health.platform.checks.redis],
    ["Worker", health.platform.checks.worker],
    ["Vector search", health.vector],
    ["Object storage", health.storage],
  ] as const;
  const slos = [
    {
      label: "Availability",
      value: `${health.operational.slos.availability.actual.toFixed(1)}%`,
      ...health.operational.slos.availability,
      targetLabel: `≥ ${health.operational.slos.availability.target}%`,
    },
    {
      label: "Chat p95 latency",
      value:
        health.operational.slos.chatP95.actual == null
          ? "Insufficient sample"
          : `${Math.round(health.operational.slos.chatP95.actual)} ms`,
      ...health.operational.slos.chatP95,
      targetLabel: `≤ ${health.operational.slos.chatP95.target} ms`,
    },
    {
      label: "Chat error rate",
      value:
        health.operational.slos.errorRate.actual == null
          ? "Insufficient sample"
          : `${health.operational.slos.errorRate.actual.toFixed(2)}%`,
      ...health.operational.slos.errorRate,
      targetLabel: `≤ ${health.operational.slos.errorRate.target}%`,
    },
    {
      label: "Index completion p95",
      value:
        health.operational.slos.indexingP95.actual == null
          ? "Insufficient sample"
          : `${health.operational.slos.indexingP95.actual.toFixed(1)} min`,
      ...health.operational.slos.indexingP95,
      targetLabel: `≤ ${health.operational.slos.indexingP95.target} min`,
    },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        title="System health"
        description={`Live infrastructure checks · ${health.platform.checkedAt}`}
      />
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {checks.map(([name, check]) => (
          <div key={name} className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">{name}</h2>
              <Badge tone={check.status === "up" ? "success" : "danger"}>
                {check.status.toUpperCase()}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Latency {check.latencyMs} ms
              {check.detail ? ` · ${check.detail}` : ""}
            </p>
          </div>
        ))}
      </section>
      <section className="rounded-xl border bg-card p-5">
        <h2 className="mb-4 font-semibold">Provider health</h2>
        <div className="divide-y">
          {health.providers.map((provider) => (
            <div
              key={provider.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm"
            >
              <div>
                <p className="font-medium">
                  {provider.name}
                  {provider.active ? " · Active" : ""}
                </p>
                <p className="text-muted-foreground">
                  Chat {provider.lastChatHealthStatus} ·{" "}
                  {provider.lastChatLatencyMs ?? "—"} ms · Embedding{" "}
                  {provider.lastEmbeddingHealthStatus} ·{" "}
                  {provider.lastEmbeddingLatencyMs ?? "—"} ms
                </p>
              </div>
              <Badge
                tone={
                  provider.lastHealthStatus === "HEALTHY"
                    ? "success"
                    : provider.lastHealthStatus === "UNHEALTHY"
                      ? "danger"
                      : "neutral"
                }
              >
                {provider.lastHealthStatus}
              </Badge>
            </div>
          ))}
          {!health.providers.length ? (
            <p className="py-5 text-sm text-muted-foreground">
              No provider configured.
            </p>
          ) : null}
        </div>
      </section>
      <section className="space-y-4 rounded-xl border bg-card p-5 sm:p-6">
        <div>
          <h2 className="font-semibold">Pilot SLO window</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Last {health.operational.windowHours} hours. Empty samples remain
            neutral and are not reported as passing.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {slos.map((slo) => (
            <article key={slo.label} className="rounded-xl border p-4">
              <div className="flex items-start justify-between gap-3">
                <h3 className="text-sm font-medium">{slo.label}</h3>
                <Badge
                  tone={
                    slo.met == null ? "neutral" : slo.met ? "success" : "danger"
                  }
                >
                  {slo.met == null ? "NO DATA" : slo.met ? "MET" : "BREACHED"}
                </Badge>
              </div>
              <p className="mt-3 text-2xl font-semibold">{slo.value}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Target {slo.targetLabel} · {slo.sampleCount} samples
              </p>
            </article>
          ))}
        </div>
      </section>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Queue and database guardrails</h2>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-muted-foreground">Queue depth</dt>
              <dd className="mt-1 font-semibold">
                {health.operational.queue.depth ?? "Unavailable"} /{" "}
                {health.operational.queue.maximumDepth}
              </dd>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-muted-foreground">Active slow queries</dt>
              <dd className="mt-1 font-semibold">
                {health.operational.slowQueries.count} · max{" "}
                {Math.round(health.operational.slowQueries.maximumDurationMs)}{" "}
                ms
              </dd>
            </div>
          </dl>
        </section>
        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="font-semibold">Automated pilot preflight</h2>
          <ul className="mt-4 space-y-3">
            {health.operational.readiness.map((item) => (
              <li
                key={item.key}
                className="flex min-h-11 items-center justify-between gap-4 rounded-lg border px-3 text-sm"
              >
                <span>{item.label}</span>
                <Badge tone={item.ready ? "success" : "danger"}>
                  {item.ready ? "READY" : "ACTION"}
                </Badge>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
