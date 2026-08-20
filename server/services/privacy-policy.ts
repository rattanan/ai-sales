import { env } from "@/schemas/env";
import { db } from "@/server/db";

export async function getEffectiveAiPrivacyPolicy(organizationId: string) {
  const configuration = env();
  const policy = await db.piiMaskingPolicy.findUnique({
    where: { organizationId },
  });
  return {
    sendSampleData: configuration.AI_SEND_SAMPLE_DATA,
    maskSensitiveData: policy?.enabled ?? configuration.AI_MASK_SENSITIVE_DATA,
    allowSensitiveAiAccess: policy?.allowSensitiveAiAccess ?? false,
    maskingRules: {
      maskEmail: policy?.maskEmail ?? true,
      maskPhone: policy?.maskPhone ?? true,
      maskNationalId: policy?.maskNationalId ?? true,
      maskFinancialAccount: policy?.maskFinancialAccount ?? true,
      maskPassport: policy?.maskPassport ?? true,
      maskHealth: policy?.maskHealth ?? true,
      maskReligion: policy?.maskReligion ?? true,
      maskBiometric: policy?.maskBiometric ?? true,
      customMaskTerms: Array.isArray(policy?.customPatterns)
        ? policy.customPatterns.filter(
            (value): value is string =>
              typeof value === "string" &&
              value.length >= 2 &&
              value.length <= 80,
          )
        : [],
    },
  };
}
