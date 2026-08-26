import { z } from "zod";
import type { LegacyApiParameter } from "@/schemas/legacy-api";
import { db } from "@/server/db";
import { authorizeResource } from "@/server/auth/resource-authorization";
import {
  invokeLegacyApi,
  legacyApiParameters,
} from "@/server/services/legacy-api-service";
import { DYNAMIC_TOOL_PREFIX } from "@/server/ai/agent/tool-registry";
import {
  defineAgentTool,
  toolFailure,
  toolSuccess,
  type AgentRunContext,
  type AgentToolDefinition,
  type GroundingEvidence,
} from "@/server/ai/agent/types";

/**
 * A tenant names its API tools freely, including in Thai. Providers accept only
 * `[A-Za-z0-9_-]`, so the readable part is slugified and the id disambiguates
 * anything that collapses to the same slug or disappears entirely.
 */
function dynamicToolName(name: string, id: string, taken: Set<string>) {
  const slug = name
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  const base = `${DYNAMIC_TOOL_PREFIX}${slug || "tool"}`;
  if (!taken.has(base)) return base;
  return `${base}_${id.slice(0, 8)}`;
}

function parameterSchema(definitions: LegacyApiParameter[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const definition of definitions) {
    const base =
      definition.type === "NUMBER"
        ? z.number()
        : definition.type === "BOOLEAN"
          ? z.boolean()
          : z.string();
    const described = base.describe(definition.description);
    shape[definition.name] = definition.required
      ? described
      : described.optional();
  }
  return z.object(shape);
}

function suppliedParameters(args: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(args).filter(
      (entry): entry is [string, string | number | boolean] =>
        entry[1] !== undefined && entry[1] !== null,
    ),
  );
}

/**
 * Registered APIs this turn may call. The HTTP request itself still goes
 * through `invokeLegacyApi`, which keeps the domain allowlist, SSRF checks,
 * response schema validation, size and redirect caps, and credential
 * decryption that the agent layer must not reimplement.
 */
export async function buildLegacyApiTools(
  context: AgentRunContext,
): Promise<AgentToolDefinition[]> {
  const [assigned, shared] = await Promise.all([
    db.botLegacyApi.findMany({
      where: {
        botId: context.botId,
        enabled: true,
        bot: {
          organizationId: context.authorization.organizationId,
          active: true,
          apiToolsEnabled: true,
        },
        legacyApi: {
          workspaceId: context.authorization.workspaceId,
          enabled: true,
          sourceStatus: "READY",
        },
      },
      include: { legacyApi: true },
      orderBy: { priority: "asc" },
    }),
    db.legacyApi.findMany({
      where: {
        organizationId: context.authorization.organizationId,
        workspaceId: context.authorization.workspaceId,
        enabled: true,
        sourceScope: "GLOBAL",
        sourceStatus: "READY",
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const candidates = [...assigned.map((item) => item.legacyApi), ...shared]
    .filter(
      (api, index, items) =>
        items.findIndex((item) => item.id === api.id) === index,
    )
    // Stable order keeps generated tool names identical between turns.
    .sort((left, right) => left.id.localeCompare(right.id));

  const taken = new Set<string>();
  const tools: AgentToolDefinition[] = [];
  for (const api of candidates) {
    const decision = await authorizeResource(
      context.authorization,
      "LEGACY_API",
      api.id,
      "USE",
    );
    if (!decision.allowed) continue;
    const definitions = legacyApiParameters(api.parameterDefinitions);
    if (!definitions) continue;
    const name = dynamicToolName(api.name, api.id, taken);
    taken.add(name);
    tools.push(
      defineAgentTool({
        name,
        kind: "DYNAMIC",
        access: "READ",
        group: "API",
        // invokeLegacyApi masks the payload per field via boundedMaskedPayload.
        selfMasked: true,
        description: `${api.name}: ${api.description} (API ที่ผู้ดูแลลงทะเบียนไว้ ใช้ดึงข้อมูลสดจากระบบภายนอก อ่านอย่างเดียว)`,
        parameters: parameterSchema(definitions),
        // Re-checked at call time: the catalog may be several steps old.
        authorize: async (runContext) =>
          (
            await authorizeResource(
              runContext.authorization,
              "LEGACY_API",
              api.id,
              "USE",
            )
          ).allowed,
        async execute(runContext, args) {
          const invoked = await invokeLegacyApi(runContext.authorization, {
            legacyApiId: api.id,
            botId: runContext.botId,
            question: runContext.userMessage,
            parameters: suppliedParameters(args as Record<string, unknown>),
          });
          if (!invoked.ok)
            return toolFailure(
              `เรียก ${api.name} ไม่สำเร็จ ตรวจสอบพารามิเตอร์แล้วลองใหม่ หรือแจ้งผู้ใช้ว่าดึงข้อมูลส่วนนี้ไม่ได้`,
              "LEGACY_API_ERROR",
            );
          if ("clarification" in invoked.data)
            return toolSuccess(
              `ต้องการพารามิเตอร์เพิ่ม: ${invoked.data.clarification}`,
            );
          const summary = [
            invoked.data.summary,
            ...invoked.data.limitations.map((item) => `• ${item}`),
          ].join("\n");
          const evidence: GroundingEvidence[] = [
            {
              content: summary,
              contentHash: invoked.data.id,
              metadata: { sourceType: "LEGACY_API", legacyApiId: api.id },
              documentId: invoked.data.id,
              sourceId: api.id,
              documentName: `API: ${api.name}`,
              mimeType: "application/vnd.insightkm.api-result",
              vectorScore: 0,
              keywordScore: 1,
              score: 1,
            },
          ];
          return toolSuccess(summary, evidence, {
            citation: {
              kind: "LEGACY_API",
              id: invoked.data.id,
              quote: summary.slice(0, 500),
              metadata: (invoked.data.citation ?? {}) as Record<
                string,
                unknown
              >,
            },
          });
        },
      }),
    );
  }
  return tools;
}
