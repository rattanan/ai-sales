import Link from "next/link";
import { notFound } from "next/navigation";
import { BriefcaseBusiness } from "lucide-react";
import { DashboardWidgetEditorTable } from "@/components/dashboard/dashboard-widget-editor-table";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { dashboardWidgetDefinitionSchema } from "@/schemas/analysis";
import { requireAuthorization } from "@/server/auth/authorization";
import {
  requireDashboardAccess,
  requirePermission,
} from "@/server/auth/permissions";
import { dashboardRepository } from "@/server/repositories/dashboards";

export default async function EditDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireAuthorization();
  await requirePermission(context, "dashboard.update");
  await requireDashboardAccess(context, id, "edit");
  const dashboard = await dashboardRepository.find(context, id);
  if (!dashboard) notFound();
  const dataSourceId = dashboard.dataSources[0]?.dataSourceId;
  const widgets = dashboard.widgets.flatMap((widget) => {
    const config =
      widget.config &&
      typeof widget.config === "object" &&
      !Array.isArray(widget.config)
        ? widget.config
        : null;
    const definition = dashboardWidgetDefinitionSchema.safeParse(
      config && "definition" in config ? config.definition : null,
    );
    return definition.success
      ? [{ recordId: widget.id, definition: definition.data }]
      : [];
  });

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow="Dashboard editor"
        title={dashboard.name}
        description="Edit chart types, display names, and descriptions, or remove widgets from the current dashboard. Saved analysis versions remain unchanged."
        action={
          dataSourceId ? (
            <Button asChild variant="outline">
              <Link
                href={`/workspace/data-sources/new?step=6&id=${encodeURIComponent(dataSourceId)}&dashboard=${encodeURIComponent(dashboard.id)}`}
              >
                <BriefcaseBusiness size={17} /> Edit business context
              </Link>
            </Button>
          ) : undefined
        }
      />
      <section aria-labelledby="widget-editor-heading">
        <h2 id="widget-editor-heading" className="text-xl font-semibold">
          Dashboard widgets
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Changing a chart type keeps the same validated query and field
          mapping. Incompatible combinations are rejected by the server.
        </p>
        <div className="mt-4">
          <DashboardWidgetEditorTable widgets={widgets} />
        </div>
      </section>
    </div>
  );
}
