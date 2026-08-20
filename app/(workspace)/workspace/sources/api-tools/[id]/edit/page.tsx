import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Plus, Sparkles } from "lucide-react";
import { LegacyApiRegistryForm } from "@/components/admin/legacy-api-registry-form";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { db } from "@/server/db";
import { requirePermission } from "@/server/auth/permissions";

function prettyJson(value: unknown, fallback: unknown) {
  return JSON.stringify(value ?? fallback, null, 2);
}

export default async function EditApiToolPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const [context, { id }] = await Promise.all([requireAuthorization(), params]);
  await requirePermission(context, "legacy_api.manage");
  const [api, bots] = await Promise.all([
    db.legacyApi.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        workspaceId: context.workspaceId,
      },
      include: {
        credential: { select: { id: true } },
        bots: { orderBy: { priority: "asc" } },
      },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  if (!api) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow="Sources · API Tools"
        title={`Edit ${api.name}`}
        description="Update this operation independently without affecting other API tools in the workspace."
        action={
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/workspace/sources/api-tools">
                <ArrowLeft size={17} aria-hidden="true" /> API Tools
              </Link>
            </Button>
            <Button asChild>
              <Link href="/workspace/sources/api-tools/new">
                <Plus size={17} aria-hidden="true" /> Add another
              </Link>
            </Button>
          </div>
        }
      />
      <section className="flex items-start gap-3 rounded-xl border border-indigo-300 bg-indigo-100 p-5 text-slate-950 shadow-sm dark:border-indigo-700 dark:bg-indigo-950 dark:text-white">
        <Sparkles
          className="mt-0.5 shrink-0 text-indigo-700 dark:text-indigo-200"
          size={18}
          aria-hidden="true"
        />
        <div>
          <h2 className="font-semibold text-indigo-950 dark:text-white">
            AI preview
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-800 dark:text-indigo-100">
            {api.previewSummary ??
              "Preview will appear after a successful bounded API test."}
          </p>
        </div>
      </section>
      <section className="rounded-xl border bg-card p-5 sm:p-6">
        <LegacyApiRegistryForm
          bots={bots}
          value={{
            id: api.id,
            name: api.name,
            description: api.description,
            baseUrl: api.baseUrl,
            endpointPath: api.endpointPath,
            method: api.method,
            readOnlyConfirmed: api.readOnlyConfirmed,
            enabled: api.enabled,
            allowedDomains: api.allowedDomains,
            timeoutMs: api.timeoutMs,
            maxResponseBytes: api.maxResponseBytes,
            maxRedirects: api.maxRedirects,
            requestHeadersJson: prettyJson(api.requestHeaders, {}),
            parametersJson: prettyJson(api.parameterDefinitions, []),
            bodyTemplateJson: prettyJson(api.bodyTemplate, null),
            responseSchemaJson: prettyJson(api.responseSchema, {}),
            responseMappingJson: prettyJson(api.responseMapping, {}),
            authType: api.authType,
            credentialPresent: Boolean(api.credential),
            sourceScope: api.sourceScope,
            botIds: api.bots.map((item) => item.botId),
            priority: api.bots[0]?.priority ?? 100,
          }}
        />
      </section>
    </div>
  );
}
