const OBJECTIVE_FIELDS = [
  "name",
  "businessArea",
  "businessObjective",
  "businessQuestions",
  "desiredKpis",
  "targetUsers",
  "reportingPeriod",
  "importantFilters",
] as const;

type DashboardObjectiveState = Record<
  (typeof OBJECTIVE_FIELDS)[number],
  string | null
>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalized(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export function dashboardObjectiveChangedSinceAnalysis(
  dashboard: DashboardObjectiveState,
  requestSnapshot: unknown,
) {
  const snapshotDashboard = record(record(requestSnapshot)?.dashboard);
  if (!snapshotDashboard) return false;
  return OBJECTIVE_FIELDS.some(
    (field) =>
      normalized(dashboard[field]) !== normalized(snapshotDashboard[field]),
  );
}

export function canStartDashboardAnalysis(
  status: string,
  dashboard: DashboardObjectiveState,
  latestCompletedRequestSnapshot: unknown,
) {
  if (status === "DRAFT") return true;
  return (
    status === "GENERATED" &&
    dashboardObjectiveChangedSinceAnalysis(
      dashboard,
      latestCompletedRequestSnapshot,
    )
  );
}
