import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { db } from "@/server/db";
import type { AIProvider, AIRequest, AIResponse } from "./types";
import { success } from "@/types/result";
import { createOrganizationAIProvider } from "@/server/services/llm-provider-config";
import { getEffectiveAiPrivacyPolicy } from "@/server/services/privacy-policy";
import { maskSensitiveText } from "@/server/services/sensitive-data";
import { logger } from "@/server/services/logger";

function requestHash(request: AIRequest<unknown>) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        schemaName: request.schemaName,
        promptVersion: request.promptVersion,
        systemPrompt: request.systemPrompt,
        userPrompt: request.userPrompt,
      }),
    )
    .digest("hex");
}

export async function generateCachedStructuredOutput<T>(
  context: AuthorizationContext,
  request: AIRequest<T>,
  provider?: AIProvider,
) {
  const [resolvedProvider, policy] = await Promise.all([
    provider ?? createOrganizationAIProvider(context.organizationId),
    getEffectiveAiPrivacyPolicy(context.organizationId),
  ]);
  const forceMasking =
    policy.maskSensitiveData || !policy.allowSensitiveAiAccess;
  const maskedSystem = forceMasking
    ? maskSensitiveText(request.systemPrompt, policy.maskingRules)
    : { text: request.systemPrompt, counts: {}, total: 0, categories: [] };
  const maskedUser = forceMasking
    ? maskSensitiveText(request.userPrompt, policy.maskingRules)
    : { text: request.userPrompt, counts: {}, total: 0, categories: [] };
  const protectedRequest = {
    ...request,
    systemPrompt: maskedSystem.text,
    userPrompt: maskedUser.text,
  };
  const maskedCounts = { ...maskedSystem.counts } as Record<string, number>;
  for (const [category, count] of Object.entries(maskedUser.counts))
    maskedCounts[category] = (maskedCounts[category] ?? 0) + count;
  const maskedTotal = maskedSystem.total + maskedUser.total;
  if (maskedTotal)
    logger.info("Sensitive AI input masked", {
      requestId: request.requestId,
      categories: Object.keys(maskedCounts).sort(),
      counts: maskedCounts,
      total: maskedTotal,
    });
  const inputHash = requestHash(protectedRequest);
  const cached = await db.aiResponseCache.findUnique({
    where: {
      workspaceId_provider_model_promptVersion_inputHash: {
        workspaceId: context.workspaceId,
        provider: resolvedProvider.name,
        model: resolvedProvider.model,
        promptVersion: request.promptVersion,
        inputHash,
      },
    },
  });
  if (!cached?.expiresAt || cached.expiresAt > new Date()) {
    const parsed = request.outputSchema.safeParse(cached?.response);
    if (parsed.success && cached)
      return success({
        data: parsed.data,
        provider: cached.provider,
        model: cached.model,
        requestId: request.requestId,
        promptVersion: cached.promptVersion,
        usage: {
          inputTokens: cached.inputTokens ?? undefined,
          outputTokens: cached.outputTokens ?? undefined,
        },
        cacheHit: true as const,
        inputHash,
      });
  }
  const result =
    await resolvedProvider.generateStructuredOutput(protectedRequest);
  if (!result.ok) return result;
  await db.aiResponseCache.upsert({
    where: {
      workspaceId_provider_model_promptVersion_inputHash: {
        workspaceId: context.workspaceId,
        provider: resolvedProvider.name,
        model: resolvedProvider.model,
        promptVersion: request.promptVersion,
        inputHash,
      },
    },
    create: {
      workspaceId: context.workspaceId,
      provider: resolvedProvider.name,
      model: resolvedProvider.model,
      promptVersion: request.promptVersion,
      inputHash,
      response: result.data.data as Prisma.InputJsonValue,
      inputTokens: result.data.usage?.inputTokens,
      outputTokens: result.data.usage?.outputTokens,
    },
    update: {
      response: result.data.data as Prisma.InputJsonValue,
      inputTokens: result.data.usage?.inputTokens,
      outputTokens: result.data.usage?.outputTokens,
      expiresAt: null,
    },
  });
  return success({
    ...result.data,
    cacheHit: false as const,
    inputHash,
  } satisfies AIResponse<T> & { cacheHit: false; inputHash: string });
}
