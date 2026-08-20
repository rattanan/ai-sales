"use client";

import { Fragment, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  LoaderCircle,
  Save,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input, Textarea } from "@/components/ui/input";
import {
  deleteDashboardWidgetAction,
  updateDashboardWidgetAction,
} from "@/features/analysis/actions";
import {
  editableDashboardWidgetTypes,
  type DashboardWidgetDefinition,
} from "@/schemas/analysis";

export type EditableDashboardWidget = {
  recordId: string;
  definition: DashboardWidgetDefinition;
};

export function DashboardWidgetEditorTable({
  widgets,
}: {
  widgets: EditableDashboardWidget[];
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!widgets.length)
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        This dashboard has no saved widgets to edit.
      </div>
    );
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b bg-slate-50 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3">Widget</th>
              <th className="w-52 px-4 py-3">Type</th>
              <th className="w-28 px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {widgets.map((widget) => {
              const open = expanded === widget.recordId;
              return (
                <Fragment key={widget.recordId}>
                  <tr className={open ? "bg-blue-50/40" : "hover:bg-muted/30"}>
                    <td className="px-4 py-3">
                      <p className="font-medium">{widget.definition.title}</p>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                        {widget.definition.description ??
                          widget.definition.businessQuestion}
                      </p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone="neutral">
                        {widget.definition.type.replaceAll("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-expanded={open}
                        onClick={() =>
                          setExpanded(open ? null : widget.recordId)
                        }
                      >
                        {open ? (
                          <ChevronDown size={16} />
                        ) : (
                          <ChevronRight size={16} />
                        )}
                        {open ? "Close" : "Edit"}
                      </Button>
                    </td>
                  </tr>
                  {open ? (
                    <tr>
                      <td colSpan={3} className="bg-slate-50/60 p-4">
                        <WidgetEditor widget={widget} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function WidgetEditor({ widget }: { widget: EditableDashboardWidget }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(widget.definition.title);
  const [description, setDescription] = useState(
    widget.definition.description ?? "",
  );
  const [widgetType, setWidgetType] = useState(widget.definition.type);
  const [gaugeTarget, setGaugeTarget] = useState(
    widget.definition.thresholds?.[0]?.value
      ? String(widget.definition.thresholds[0].value)
      : "",
  );
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function save() {
    startTransition(async () => {
      setMessage(null);
      const result = await updateDashboardWidgetAction({
        widgetId: widget.recordId,
        title,
        description,
        widgetType,
        gaugeTarget:
          ["GAUGE", "PROGRESS_RING", "BULLET_CHART"].includes(widgetType) &&
          gaugeTarget
            ? gaugeTarget
            : undefined,
      });
      if (!result.ok) return setMessage(result.error.message);
      setMessage("Widget updated.");
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      setMessage(null);
      const result = await deleteDashboardWidgetAction({
        widgetId: widget.recordId,
      });
      if (!result.ok) return setMessage(result.error.message);
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name" htmlFor={`edit-title-${widget.recordId}`}>
          <Input
            id={`edit-title-${widget.recordId}`}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label="Chart / widget type"
          htmlFor={`edit-type-${widget.recordId}`}
        >
          <select
            id={`edit-type-${widget.recordId}`}
            value={widgetType}
            onChange={(event) =>
              setWidgetType(event.target.value as typeof widgetType)
            }
            className="min-h-11 w-full rounded-lg border bg-white px-3 text-sm"
          >
            {editableDashboardWidgetTypes.map((type) => (
              <option key={type} value={type}>
                {type.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </Field>
        {["GAUGE", "PROGRESS_RING", "BULLET_CHART"].includes(widgetType) ? (
          <Field
            label="Target value"
            htmlFor={`edit-target-${widget.recordId}`}
          >
            <Input
              id={`edit-target-${widget.recordId}`}
              type="number"
              min="0.000001"
              step="any"
              value={gaugeTarget}
              onChange={(event) => setGaugeTarget(event.target.value)}
              required
            />
          </Field>
        ) : null}
        <Field
          label="Description"
          htmlFor={`edit-description-${widget.recordId}`}
          className="sm:col-span-2"
        >
          <Textarea
            id={`edit-description-${widget.recordId}`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t pt-4">
        <Button type="button" disabled={pending} onClick={save}>
          {pending ? (
            <LoaderCircle className="animate-spin" size={17} />
          ) : (
            <Save size={17} />
          )}
          Save widget
        </Button>
        {!confirmDelete ? (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={17} /> Delete
          </Button>
        ) : (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2">
            <span className="px-1 text-xs text-red-800">
              Delete this widget?
            </span>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={pending}
              onClick={remove}
            >
              Confirm delete
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </Button>
          </div>
        )}
        {message ? (
          <p className="text-sm text-muted-foreground" aria-live="polite">
            {message}
          </p>
        ) : null}
      </div>
    </div>
  );
}
