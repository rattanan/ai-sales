import { z } from "zod";
import type { ChatScope } from "@/generated/prisma/client";
import {
  defineAgentTool,
  toolSuccess,
  type AgentToolDefinition,
  type AgentToolGroup,
  type GroundingEvidence,
} from "@/server/ai/agent/types";
import {
  listDocumentSources,
  searchDocuments,
} from "@/server/ai/agent/system-tools/documents";
import {
  searchBusinessInsights,
  searchConversationHistory,
} from "@/server/ai/agent/system-tools/conversation";
import {
  listDataSources,
  queryDatabase,
} from "@/server/ai/agent/system-tools/database";
import { webSearch } from "@/server/ai/agent/system-tools/web";
import { getCurrentDatetime } from "@/server/ai/agent/system-tools/datetime";
import { DISPLAY_SYSTEM_TOOLS } from "@/server/ai/agent/system-tools/display";

/**
 * Tools compiled into the platform. Unlike the dynamic tools they are not
 * tenant-configurable, so a workspace can never remove, rename, or shadow one.
 */
export const SYSTEM_TOOLS: AgentToolDefinition[] = [
  searchDocuments,
  listDocumentSources,
  searchConversationHistory,
  searchBusinessInsights,
  listDataSources,
  queryDatabase,
  webSearch,
  ...DISPLAY_SYSTEM_TOOLS,
  getCurrentDatetime,
];

export const SYSTEM_TOOL_NAMES = new Set(SYSTEM_TOOLS.map((tool) => tool.name));

/**
 * Every tenant-defined tool carries this prefix. Without it a workspace could
 * register an API tool named `search_documents` and shadow a system tool for
 * every user in that workspace.
 */
export const DYNAMIC_TOOL_PREFIX = "api__";

/**
 * Which tool groups each request scope exposes. PLATFORM is added to every
 * scope: knowing the current date is a precondition for answering correctly,
 * not a data source the user is choosing between.
 */
const SCOPE_GROUPS: Record<ChatScope, AgentToolGroup[]> = {
  SMART: ["DOCUMENT", "HISTORY", "INSIGHT", "DATABASE", "API", "NTOP", "WEB"],
  ALL_ACCESSIBLE: [
    "DOCUMENT",
    "HISTORY",
    "INSIGHT",
    "DATABASE",
    "API",
    "NTOP",
    "WEB",
  ],
  SPECIFIC_BOT: ["DOCUMENT", "NTOP", "WEB"],
  SPECIFIC_SOURCES: ["DOCUMENT"],
  DOCUMENTS: ["DOCUMENT"],
  DATABASES: ["DATABASE"],
  API_TOOLS: ["API"],
  CONVERSATION_HISTORY: ["HISTORY"],
  BUSINESS_INSIGHT: ["INSIGHT"],
};

const KNOWLEDGE_SOURCE_TOOL = {
  document: searchDocuments,
  conversation: searchConversationHistory,
  insight: searchBusinessInsights,
} as const;

type KnowledgeSourceKey = keyof typeof KNOWLEDGE_SOURCE_TOOL;

/**
 * COMBINED mode folds the knowledge searches into one tool. A short catalog
 * measurably improves tool choice on smaller local models, at the cost of the
 * per-source descriptions that help larger ones pick correctly.
 */
function createSearchKnowledge(
  enabled: KnowledgeSourceKey[],
): AgentToolDefinition {
  return defineAgentTool({
    name: "search_knowledge",
    kind: "SYSTEM",
    access: "READ",
    group: "DOCUMENT",
    description:
      "ค้นหาข้อมูลจากฐานความรู้ทุกแหล่งที่เปิดใช้งานพร้อมกัน (เอกสารองค์กร / บทสนทนาเก่าของผู้ใช้ / ผลวิเคราะห์ Business Insight) " +
      "ใช้เมื่อคำถามน่าจะตอบได้จากความรู้ที่มีอยู่แล้ว " +
      "ไม่ใช่ข้อมูลสดในฐานข้อมูล (กรณีนั้นให้ใช้ query_database)",
    parameters: z.object({
      query: z
        .string()
        .trim()
        .min(1)
        .max(500)
        .describe("คำค้นหรือหัวข้อที่ต้องการ ใช้ภาษาเดียวกับผู้ใช้"),
      sources: z
        .array(z.enum(enabled as [KnowledgeSourceKey, ...KnowledgeSourceKey[]]))
        .optional()
        .describe("แหล่งที่ต้องการค้น ไม่ระบุ = ค้นทุกแหล่งที่เปิดใช้งาน"),
    }),
    async execute(context, args) {
      const selected = (args.sources?.length ? args.sources : enabled).filter(
        (source): source is KnowledgeSourceKey => enabled.includes(source),
      );
      const results = await Promise.all(
        selected.map((source) =>
          KNOWLEDGE_SOURCE_TOOL[source]
            .execute(context, { query: args.query })
            .then((result) => ({ source, result })),
        ),
      );
      const evidence: GroundingEvidence[] = results.flatMap(
        ({ result }) => result.evidence,
      );
      const summary = results
        .map(({ source, result }) => `[${source}] ${result.content}`)
        .join("\n");
      return toolSuccess(summary, evidence);
    },
  });
}

export type ToolCatalogOptions = {
  scope: ChatScope;
  /** Per-bot switches that already gate the legacy pipeline. */
  databaseToolsEnabled: boolean;
  apiToolsEnabled: boolean;
  /** The request's Web Search toggle. */
  webSearchRequested: boolean;
  toolMode: "SEPARATE" | "COMBINED";
  /**
   * Tool names an administrator switched off for this bot. Applied after every
   * other rule, so a disabled tool is never advertised and never callable.
   */
  disabledTools?: string[];
  /** Tenant-defined tools resolved for this turn. */
  dynamicTools?: AgentToolDefinition[];
};

export class DuplicateToolNameError extends Error {
  constructor(readonly toolName: string) {
    super(`Tool name "${toolName}" is already registered.`);
    this.name = "DuplicateToolNameError";
  }
}

export class InvalidToolNameError extends Error {
  constructor(readonly toolName: string) {
    super(
      `Tenant-defined tool "${toolName}" must start with "${DYNAMIC_TOOL_PREFIX}".`,
    );
    this.name = "InvalidToolNameError";
  }
}

/**
 * Builds the tool set for one turn. The returned map is both the catalog sent
 * to the model and the dispatch table the executor routes on, so a tool can
 * never be advertised without being callable, or callable without having been
 * advertised.
 */
export function buildToolCatalog(
  options: ToolCatalogOptions,
): Map<string, AgentToolDefinition> {
  const allowedGroups = new Set<AgentToolGroup>([
    ...SCOPE_GROUPS[options.scope],
    "DISPLAY",
    "PLATFORM",
  ]);
  if (!options.databaseToolsEnabled) allowedGroups.delete("DATABASE");
  if (!options.apiToolsEnabled) allowedGroups.delete("API");
  if (!options.webSearchRequested) allowedGroups.delete("WEB");

  const disabled = new Set(options.disabledTools ?? []);
  const catalog = new Map<string, AgentToolDefinition>();
  const register = (tool: AgentToolDefinition) => {
    if (catalog.has(tool.name)) throw new DuplicateToolNameError(tool.name);
    if (disabled.has(tool.name)) return;
    catalog.set(tool.name, tool);
  };

  const knowledgeGroups: Array<[KnowledgeSourceKey, AgentToolGroup]> = [
    ["document", "DOCUMENT"],
    ["conversation", "HISTORY"],
    ["insight", "INSIGHT"],
  ];
  const enabledKnowledge = knowledgeGroups
    .filter(([, group]) => allowedGroups.has(group))
    .filter(([key]) => !disabled.has(KNOWLEDGE_SOURCE_TOOL[key].name))
    .map(([key]) => key);
  const combineKnowledge =
    options.toolMode === "COMBINED" && enabledKnowledge.length > 1;

  for (const tool of SYSTEM_TOOLS) {
    if (!allowedGroups.has(tool.group)) continue;
    if (
      combineKnowledge &&
      (Object.values(KNOWLEDGE_SOURCE_TOOL) as AgentToolDefinition[]).includes(
        tool,
      )
    )
      continue;
    register(tool);
  }
  if (combineKnowledge) register(createSearchKnowledge(enabledKnowledge));

  for (const tool of options.dynamicTools ?? []) {
    if (!allowedGroups.has(tool.group)) continue;
    // The prefix exists to stop a tenant-chosen name from impersonating a
    // platform tool, so it is required of every name that came from tenant
    // input. Tools whose names are literals here are exempt, but still may not
    // collide with a system tool.
    if (!tool.codeDefinedName && !tool.name.startsWith(DYNAMIC_TOOL_PREFIX))
      throw new InvalidToolNameError(tool.name);
    if (SYSTEM_TOOL_NAMES.has(tool.name))
      throw new DuplicateToolNameError(tool.name);
    register(tool);
  }
  return catalog;
}

/** The `tools` array an OpenAI-compatible provider expects. */
export function toolCatalogPayload(catalog: Map<string, AgentToolDefinition>) {
  return [...catalog.values()].map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: z.toJSONSchema(tool.parameters, { target: "draft-7" }),
    },
  }));
}
