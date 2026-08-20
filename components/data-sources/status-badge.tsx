import { Badge } from "@/components/ui/badge";

export function DataSourceStatusBadge({ status }: { status: string }) {
  const tone =
    status === "CONNECTED"
      ? "success"
      : status === "FAILED"
        ? "danger"
        : status === "TESTING"
          ? "warning"
          : "neutral";
  return <Badge tone={tone}>{status.replaceAll("_", " ")}</Badge>;
}
