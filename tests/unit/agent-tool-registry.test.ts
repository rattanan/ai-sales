import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  DuplicateToolNameError,
  DYNAMIC_TOOL_PREFIX,
  InvalidToolNameError,
  SYSTEM_TOOL_NAMES,
  buildToolCatalog,
  toolCatalogPayload,
  type ToolCatalogOptions,
} from "@/server/ai/agent/tool-registry";
import { defineAgentTool, toolSuccess } from "@/server/ai/agent/types";
import { AGENT_TOOL_CATALOG } from "@/lib/agent-tool-catalog";

function options(
  overrides: Partial<ToolCatalogOptions> = {},
): ToolCatalogOptions {
  return {
    scope: "SMART",
    databaseToolsEnabled: true,
    apiToolsEnabled: true,
    webSearchRequested: true,
    toolMode: "SEPARATE",
    ...overrides,
  };
}

function dynamicTool(name: string, codeDefinedName = false) {
  return defineAgentTool({
    name,
    kind: "DYNAMIC",
    access: "READ",
    group: "API",
    description: "ทดสอบ",
    codeDefinedName,
    parameters: z.object({}),
    execute: async () => toolSuccess("ok"),
  });
}

describe("buildToolCatalog", () => {
  it("exposes every system tool group under SMART scope", () => {
    const names = [...buildToolCatalog(options()).keys()];

    expect(names).toEqual(
      expect.arrayContaining([
        "search_documents",
        "list_document_sources",
        "search_conversation_history",
        "search_business_insights",
        "list_data_sources",
        "query_database",
        "web_search",
        "display_qr",
        "display_chart",
        "display_image",
        "get_current_datetime",
      ]),
    );
  });

  it("narrows the catalog to the requested scope", () => {
    expect([
      ...buildToolCatalog(options({ scope: "DATABASES" })).keys(),
    ]).toEqual([
      "list_data_sources",
      "query_database",
      "display_qr",
      "display_chart",
      "display_image",
      "get_current_datetime",
    ]);
    expect([
      ...buildToolCatalog(options({ scope: "CONVERSATION_HISTORY" })).keys(),
    ]).toEqual([
      "search_conversation_history",
      "display_qr",
      "display_chart",
      "display_image",
      "get_current_datetime",
    ]);
    expect([
      ...buildToolCatalog(options({ scope: "BUSINESS_INSIGHT" })).keys(),
    ]).toEqual([
      "search_business_insights",
      "display_qr",
      "display_chart",
      "display_image",
      "get_current_datetime",
    ]);
  });

  it("keeps the clock available in every scope", () => {
    const scopes = [
      "SMART",
      "DOCUMENTS",
      "DATABASES",
      "API_TOOLS",
      "CONVERSATION_HISTORY",
      "BUSINESS_INSIGHT",
      "SPECIFIC_SOURCES",
      "SPECIFIC_BOT",
      "ALL_ACCESSIBLE",
    ] as const;

    for (const scope of scopes)
      expect(
        buildToolCatalog(options({ scope })).has("get_current_datetime"),
      ).toBe(true);
  });

  it("drops tool groups the bot or request switched off", () => {
    const catalog = buildToolCatalog(
      options({
        databaseToolsEnabled: false,
        apiToolsEnabled: false,
        webSearchRequested: false,
        dynamicTools: [dynamicTool(`${DYNAMIC_TOOL_PREFIX}weather`)],
      }),
    );

    expect(catalog.has("query_database")).toBe(false);
    expect(catalog.has("web_search")).toBe(false);
    expect(catalog.has(`${DYNAMIC_TOOL_PREFIX}weather`)).toBe(false);
    expect(catalog.has("search_documents")).toBe(true);
  });

  it("folds the knowledge searches into one tool in COMBINED mode", () => {
    const catalog = buildToolCatalog(options({ toolMode: "COMBINED" }));

    expect(catalog.has("search_knowledge")).toBe(true);
    expect(catalog.has("search_documents")).toBe(false);
    expect(catalog.has("search_conversation_history")).toBe(false);
    // Non-knowledge tools are unaffected by the fold.
    expect(catalog.has("query_database")).toBe(true);
  });

  it("keeps the single knowledge tool as-is when only one source is in scope", () => {
    const catalog = buildToolCatalog(
      options({ scope: "DOCUMENTS", toolMode: "COMBINED" }),
    );

    expect(catalog.has("search_documents")).toBe(true);
    expect(catalog.has("search_knowledge")).toBe(false);
  });

  it("rejects a tenant tool that would shadow a system tool", () => {
    expect(() =>
      buildToolCatalog(
        options({ dynamicTools: [dynamicTool("search_documents")] }),
      ),
    ).toThrow(InvalidToolNameError);

    expect(() =>
      buildToolCatalog(
        options({
          dynamicTools: [dynamicTool(`${DYNAMIC_TOOL_PREFIX}search_documents`)],
        }),
      ),
    ).not.toThrow();
  });

  it("exempts a code-defined name from the prefix but not from collisions", () => {
    // The prefix guards against tenant input choosing the name. A name written
    // in this repository needs no prefix — the platform's own NTOP tools are
    // registered this way — yet it may still never take a system tool's name.
    expect(() =>
      buildToolCatalog(
        options({ dynamicTools: [dynamicTool("ntop_search", true)] }),
      ),
    ).not.toThrow();

    expect(() =>
      buildToolCatalog(
        options({ dynamicTools: [dynamicTool("search_documents", true)] }),
      ),
    ).toThrow(DuplicateToolNameError);
  });

  it("rejects two tenant tools claiming the same name", () => {
    expect(() =>
      buildToolCatalog(
        options({
          dynamicTools: [
            dynamicTool(`${DYNAMIC_TOOL_PREFIX}weather`),
            dynamicTool(`${DYNAMIC_TOOL_PREFIX}weather`),
          ],
        }),
      ),
    ).toThrow(DuplicateToolNameError);
  });

  it("never lets a tenant tool take a reserved system name", () => {
    for (const name of SYSTEM_TOOL_NAMES)
      expect(() =>
        buildToolCatalog(options({ dynamicTools: [dynamicTool(name)] })),
      ).toThrow();
  });
});

describe("toolCatalogPayload", () => {
  it("emits a JSON Schema function definition per tool", () => {
    const payload = toolCatalogPayload(
      buildToolCatalog(options({ scope: "DOCUMENTS" })),
    );
    const search = payload.find(
      (tool) => tool.function.name === "search_documents",
    );

    expect(search?.type).toBe("function");
    expect(search?.function.parameters).toMatchObject({
      type: "object",
      required: ["query"],
      properties: { query: { type: "string" } },
    });
    // Descriptions steer tool choice, so an empty one is a defect.
    for (const tool of payload)
      expect(tool.function.description.length).toBeGreaterThan(40);
  });

  it("documents every parameter for the model", () => {
    const payload = toolCatalogPayload(buildToolCatalog(options()));

    for (const tool of payload) {
      const properties =
        (tool.function.parameters as { properties?: Record<string, unknown> })
          .properties ?? {};
      for (const [name, schema] of Object.entries(properties))
        expect(
          (schema as { description?: string }).description,
          `${tool.function.name}.${name} has no description`,
        ).toBeTruthy();
    }
  });
});

describe("per-bot tool switches", () => {
  it("removes a disabled tool from the catalog entirely", () => {
    const catalog = buildToolCatalog(
      options({ disabledTools: ["query_database", "web_search"] }),
    );

    expect(catalog.has("query_database")).toBe(false);
    expect(catalog.has("web_search")).toBe(false);
    // A disabled tool is neither advertised nor dispatchable, since the
    // catalog is also the router.
    expect(catalog.has("list_data_sources")).toBe(true);
    expect(catalog.has("search_documents")).toBe(true);
  });

  it("keeps a disabled source out of the combined knowledge tool", () => {
    const combined = buildToolCatalog(
      options({
        toolMode: "COMBINED",
        disabledTools: ["search_conversation_history"],
      }),
    );
    const sources = (
      z.toJSONSchema(combined.get("search_knowledge")!.parameters, {
        target: "draft-7",
      }) as {
        properties?: { sources?: { items?: { enum?: string[] } } };
      }
    ).properties?.sources?.items?.enum;

    expect(sources).toEqual(["document", "insight"]);
  });

  it("falls back to the single remaining tool when the fold is pointless", () => {
    const catalog = buildToolCatalog(
      options({
        toolMode: "COMBINED",
        disabledTools: [
          "search_conversation_history",
          "search_business_insights",
        ],
      }),
    );

    expect(catalog.has("search_documents")).toBe(true);
    expect(catalog.has("search_knowledge")).toBe(false);
  });

  it("ignores a disabled name that is not a tool", () => {
    expect(() =>
      buildToolCatalog(options({ disabledTools: ["not_a_tool"] })),
    ).not.toThrow();
  });
});

describe("configuration catalog", () => {
  it("can manage every tool the registry can build", () => {
    // A tool missing from the UI catalog would be unmanageable: no switch, no
    // label, invisible to whoever configures the bot.
    const managed = new Set(AGENT_TOOL_CATALOG.map((tool) => tool.name));

    for (const name of SYSTEM_TOOL_NAMES)
      expect(managed, `${name} is missing from AGENT_TOOL_CATALOG`).toContain(
        name,
      );
  });

  it("lists no tool the registry cannot produce", () => {
    const buildable = new Set([
      ...SYSTEM_TOOL_NAMES,
      // Only exists in COMBINED mode, where the factory creates it.
      "search_knowledge",
    ]);

    for (const tool of AGENT_TOOL_CATALOG)
      expect(buildable, `${tool.name} is not a real tool`).toContain(tool.name);
  });

  it("describes every tool for the person configuring it", () => {
    for (const tool of AGENT_TOOL_CATALOG) {
      expect(tool.label.length).toBeGreaterThan(2);
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });
});
