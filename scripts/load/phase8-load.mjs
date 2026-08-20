import { performance } from "node:perf_hooks";

const baseUrl = process.env.PHASE8_LOAD_BASE_URL ?? "http://127.0.0.1:3000";
const concurrency = Math.max(
  1,
  Number(process.env.PHASE8_LOAD_CONCURRENCY ?? 10),
);
const iterations = Math.max(
  1,
  Number(process.env.PHASE8_LOAD_ITERATIONS ?? 10),
);
const cookie = process.env.PHASE8_LOAD_COOKIE;
const scenarios = process.env.PHASE8_LOAD_SCENARIOS
  ? JSON.parse(process.env.PHASE8_LOAD_SCENARIOS)
  : [
      {
        name: "health",
        method: "GET",
        path: "/api/v1/health",
        expectedStatus: 200,
      },
    ];

if (!Array.isArray(scenarios) || !scenarios.length)
  throw new Error("PHASE8_LOAD_SCENARIOS must be a non-empty JSON array");

const observations = [];
async function execute(scenario) {
  const startedAt = performance.now();
  try {
    const response = await fetch(new URL(scenario.path, baseUrl), {
      method: scenario.method ?? "GET",
      headers: {
        ...(scenario.body ? { "content-type": "application/json" } : {}),
        ...(cookie ? { cookie } : {}),
        origin: new URL(baseUrl).origin,
      },
      body: scenario.body ? JSON.stringify(scenario.body) : undefined,
      signal: AbortSignal.timeout(Number(scenario.timeoutMs ?? 300_000)),
    });
    const payload = await response.json().catch(() => null);
    const expected = Number(scenario.expectedStatus ?? 200);
    const citationValid =
      !scenario.requireCitation ||
      Boolean(
        payload?.assistantMessage?.citations?.length &&
        payload.assistantMessage.citations.every(
          (citation) => citation.id && citation.rank > 0 && citation.quote,
        ),
      );
    observations.push({
      name: scenario.name,
      latencyMs: performance.now() - startedAt,
      ok: response.status === expected && citationValid,
      status: response.status,
      citationValid,
    });
  } catch (error) {
    observations.push({
      name: scenario.name,
      latencyMs: performance.now() - startedAt,
      ok: false,
      error: error instanceof Error ? error.name : "UNKNOWN",
    });
  }
}

const work = Array.from({ length: iterations }, (_, iteration) =>
  scenarios.map((scenario) => ({ ...scenario, iteration })),
).flat();
let cursor = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (cursor < work.length) {
      const item = work[cursor++];
      await execute(item);
    }
  }),
);

const sorted = observations
  .map(({ latencyMs }) => latencyMs)
  .sort((a, b) => a - b);
const p95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
const failed = observations.filter(({ ok }) => !ok);
const summary = {
  requests: observations.length,
  concurrency,
  failures: failed.length,
  errorRatePercent: observations.length
    ? (failed.length / observations.length) * 100
    : 0,
  p95LatencyMs: Math.round(p95),
  byScenario: Object.fromEntries(
    scenarios.map((scenario) => {
      const rows = observations.filter(({ name }) => name === scenario.name);
      return [
        scenario.name,
        {
          requests: rows.length,
          failures: rows.filter(({ ok }) => !ok).length,
        },
      ];
    }),
  ),
};
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
const maxErrorRate = Number(process.env.PHASE8_LOAD_MAX_ERROR_PERCENT ?? 2);
const maxP95 = Number(process.env.PHASE8_LOAD_MAX_P95_MS ?? 15_000);
if (summary.errorRatePercent > maxErrorRate || summary.p95LatencyMs > maxP95)
  process.exitCode = 1;
