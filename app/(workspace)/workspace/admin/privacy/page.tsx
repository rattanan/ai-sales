import { PrivacyPolicyForm } from "@/components/admin/phase1-forms";
import { PageHeader } from "@/components/ui/page-header";
import { requireAuthorization } from "@/server/auth/authorization";
import { requirePermission } from "@/server/auth/permissions";
import { db } from "@/server/db";

export default async function PrivacyPage() {
  const context = await requireAuthorization();
  await requirePermission(context, "privacy.manage");
  const [privacy, retention] = await Promise.all([
    db.piiMaskingPolicy.findUnique({
      where: { organizationId: context.organizationId },
    }),
    db.systemRetentionPolicy.findUnique({
      where: { organizationId: context.organizationId },
    }),
  ]);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Privacy & retention"
        description="Control PII masking before AI processing and define auditable data-retention windows."
      />
      <section className="rounded-xl border bg-card p-5">
        <PrivacyPolicyForm
          policy={{
            enabled: privacy?.enabled ?? true,
            maskEmail: privacy?.maskEmail ?? true,
            maskPhone: privacy?.maskPhone ?? true,
            maskNationalId: privacy?.maskNationalId ?? true,
            maskFinancialAccount: privacy?.maskFinancialAccount ?? true,
            maskPassport: privacy?.maskPassport ?? true,
            maskHealth: privacy?.maskHealth ?? true,
            maskReligion: privacy?.maskReligion ?? true,
            maskBiometric: privacy?.maskBiometric ?? true,
            customMaskTerms: Array.isArray(privacy?.customPatterns)
              ? privacy.customPatterns.filter(
                  (value): value is string => typeof value === "string",
                )
              : [],
            allowSensitiveAiAccess: privacy?.allowSensitiveAiAccess ?? false,
            auditLogDays: retention?.auditLogDays ?? 365,
            loginHistoryDays: retention?.loginHistoryDays ?? 180,
            chatHistoryDays: retention?.chatHistoryDays ?? 90,
            memoryRetentionDays: retention?.memoryRetentionDays ?? 365,
          }}
        />
      </section>
    </div>
  );
}
