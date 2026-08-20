import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";

export const metadata = { title: "Workspace settings" };
export default async function SettingsPage() {
  const context = await requireAuthorization();
  const configuration = env();
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: context.workspaceId },
    include: {
      organization: {
        include: {
          members: { include: { user: true }, orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  return (
    <div className="space-y-7">
      <PageHeader
        title="Workspace settings"
        description="Organization membership is visible here. Invitations and advanced permission editing arrive in a later phase."
      />
      <Card>
        <CardHeader>
          <CardTitle>{workspace.organization.name}</CardTitle>
          <CardDescription>Workspace: {workspace.name}</CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          {workspace.organization.members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium">
                  {member.user.name || "Unnamed user"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {member.user.email}
                </p>
              </div>
              <Badge tone={member.role === "OWNER" ? "info" : "neutral"}>
                {member.role.replaceAll("_", " ")}
              </Badge>
            </div>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>AI data privacy</CardTitle>
          <CardDescription>
            Controls that govern what database content may be included in AI
            analysis requests.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`flex gap-4 rounded-xl border p-5 ${
              configuration.AI_SEND_SAMPLE_DATA
                ? "border-amber-200 bg-amber-50/70"
                : "border-emerald-200 bg-emerald-50/70"
            }`}
            role="status"
          >
            <span
              className={`mt-0.5 grid size-10 shrink-0 place-items-center rounded-lg ${
                configuration.AI_SEND_SAMPLE_DATA
                  ? "bg-amber-100 text-amber-700"
                  : "bg-emerald-100 text-emerald-700"
              }`}
              aria-hidden="true"
            >
              {configuration.AI_SEND_SAMPLE_DATA ? (
                <TriangleAlert size={20} />
              ) : (
                <ShieldCheck size={20} />
              )}
            </span>
            <div className="min-w-0">
              <p className="font-semibold text-slate-950">
                {configuration.AI_SEND_SAMPLE_DATA
                  ? "Limited sample rows may be sent to the AI provider"
                  : "AI analysis uses metadata only"}
              </p>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                {configuration.AI_SEND_SAMPLE_DATA
                  ? `Up to ${configuration.AI_SAMPLE_ROWS_PER_TABLE} sample row(s) per included table and validated query previews used for grounded insights may be transmitted to ${configuration.AI_BASE_URL}. ${
                      configuration.AI_MASK_SENSITIVE_DATA
                        ? "Likely sensitive values are masked first."
                        : "Sensitive-value masking is disabled."
                    }`
                  : "Table names, column definitions, relationships, and business objectives may be sent, but database row values are excluded."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge
                  tone={
                    configuration.AI_SEND_SAMPLE_DATA ? "warning" : "success"
                  }
                >
                  Sample data {configuration.AI_SEND_SAMPLE_DATA ? "on" : "off"}
                </Badge>
                <Badge
                  tone={
                    configuration.AI_MASK_SENSITIVE_DATA ? "success" : "warning"
                  }
                >
                  Sensitive masking{" "}
                  {configuration.AI_MASK_SENSITIVE_DATA ? "on" : "off"}
                </Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
