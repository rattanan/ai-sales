import {
  AuthenticationPolicyForm,
  ExternalAuthenticationTestForm,
} from "@/components/admin/phase3-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

function record(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, string>)
    : {};
}

export default async function AuthenticationAdminPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "organization.manage");
  const [policy, bots] = await Promise.all([
    db.authenticationPolicy.findUnique({
      where: { organizationId: context.organizationId },
      include: {
        embeddedConfig: true,
        externalApiConfig: { include: { credential: true } },
      },
    }),
    db.bot.findMany({
      where: { organizationId: context.organizationId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const priority = Array.isArray(policy?.modePriority)
    ? policy.modePriority.filter(
        (item): item is string => typeof item === "string",
      )
    : ["EMBEDDED", "EXTERNAL_API", "LOCAL"];
  const external = policy?.externalApiConfig;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Authentication & embedded widget"
        description="Configure tenant authentication precedence, signed embedded identity, external credential validation, and host integration."
      />
      <AuthenticationPolicyForm
        value={{
          localEnabled: policy?.localEnabled ?? true,
          externalApiEnabled: policy?.externalApiEnabled ?? false,
          embeddedEnabled: policy?.embeddedEnabled ?? false,
          modePriority: priority,
          embedded: policy?.embeddedConfig
            ? {
                keyId: policy.embeddedConfig.keyId,
                signatureMode: policy.embeddedConfig.signatureMode,
                allowedOrigins: policy.embeddedConfig.allowedOrigins,
                replayWindowSeconds: policy.embeddedConfig.replayWindowSeconds,
                sessionTtlSeconds: policy.embeddedConfig.sessionTtlSeconds,
                lastRotatedAt:
                  policy.embeddedConfig.lastRotatedAt.toISOString(),
              }
            : undefined,
          external: external
            ? {
                url: external.url,
                method: external.method,
                timeoutMs: external.timeoutMs,
                headers: record(external.headers),
                requestMapping: record(external.requestMapping),
                responseMapping: record(external.responseMapping),
                secretHeaderName: external.credential?.headerName,
                hasSecret: Boolean(external.credential),
                lastHealthStatus: external.lastHealthStatus ?? undefined,
                lastHealthMessage: external.lastHealthMessage ?? undefined,
              }
            : undefined,
        }}
      />
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="font-semibold">External API contract test</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tests the saved endpoint, headers, timeout, and response mapping
            without creating a user or retaining credentials.
          </p>
          {external?.lastHealthStatus ? (
            <p className="mt-2 text-sm">
              Last result: {external.lastHealthStatus} ·{" "}
              {external.lastHealthMessage}
            </p>
          ) : null}
        </div>
        <ExternalAuthenticationTestForm />
      </section>
      <section className="space-y-4 rounded-xl border bg-slate-950 p-5 text-slate-100">
        <div>
          <h2 className="font-semibold">Embed code</h2>
          <p className="mt-1 text-sm text-slate-300">
            Generate the signed identity on your server. Never place the signing
            secret or signing logic in browser code.
          </p>
        </div>
        {bots.length ? (
          bots.map((bot) => (
            <div key={bot.id} className="space-y-2">
              <p className="text-sm font-medium">{bot.name}</p>
              <pre className="overflow-x-auto rounded-lg bg-black/40 p-4 text-xs">
                <code>{`<script src="https://YOUR-INSIGHTKM-HOST/widget/v1.js"></script>\n<script>\n  InsightKMWidget.init({\n    botId: "${bot.id}",\n    apiBase: "https://YOUR-INSIGHTKM-HOST",\n    hostOrigin: window.location.origin,\n    payload: SIGNED_PAYLOAD_FROM_YOUR_SERVER,\n    signature: SIGNATURE_FROM_YOUR_SERVER\n  });\n</script>`}</code>
              </pre>
            </div>
          ))
        ) : (
          <p className="text-sm text-slate-300">
            Activate a bot before generating embed code.
          </p>
        )}
      </section>
    </div>
  );
}
