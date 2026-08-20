import Link from "next/link";

const items = [
  ["Overview", "/workspace/analytics/overview"],
  ["Business Insight", "/workspace/analytics/business-insight"],
  ["Topics & Trends", "/workspace/analytics/topics"],
  ["Unanswered Questions", "/workspace/analytics/unanswered"],
  ["Knowledge Gaps", "/workspace/analytics/knowledge-gaps"],
  ["Bot Performance", "/workspace/analytics/bot-performance"],
  ["Source Performance", "/workspace/analytics/source-performance"],
  ["Reports", "/workspace/analytics/reports"],
] as const;

export function AnalyticsNav() {
  return (
    <nav
      aria-label="Analytics sections"
      className="flex gap-2 overflow-x-auto border-b pb-3"
    >
      {items.map(([label, href]) => (
        <Link
          key={href}
          href={href}
          className="min-h-11 shrink-0 rounded-lg px-3 py-3 text-sm font-medium hover:bg-muted"
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
