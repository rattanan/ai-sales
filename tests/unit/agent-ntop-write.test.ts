import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configuredNtopConnectionForUser: vi.fn(),
}));

vi.mock("@/server/integrations/ntop/client", () => ({
  configuredNtopConnectionForUser: mocks.configuredNtopConnectionForUser,
}));

import { buildNtopTools } from "@/server/ai/agent/dynamic-tools/ntop";
import { buildToolCatalog } from "@/server/ai/agent/tool-registry";
import type { AgentRunContext } from "@/server/ai/agent/types";

const context: AgentRunContext = {
  authorization: {
    userId: "user-1",
    organizationId: "org-1",
    workspaceId: "ws-1",
    role: "VIEWER",
  },
  botId: "bot-1",
  conversationId: "conv-1",
  currentMessageId: "msg-1",
  userMessage: "ลูกค้า ACME สนใจ Fix IP งบ 20000",
  retrieval: { allAccessible: false, sourceIds: [], documentIds: [] },
  contextSize: 12_000,
  timezone: "Asia/Bangkok",
  privacyPolicy: {
    sendSampleData: false,
    maskSensitiveData: false,
    allowSensitiveAiAccess: false,
    maskingRules: {
      maskEmail: true,
      maskPhone: true,
      maskNationalId: true,
      maskFinancialAccount: true,
      maskPassport: true,
      maskHealth: true,
      maskReligion: true,
      maskBiometric: true,
      customMaskTerms: [],
    },
  },
  isUniversal: false,
};

/** Every write path on the client; none of them may be reached from the loop. */
function writeSpies() {
  return {
    createProspect: vi.fn(),
    createLead: vi.fn(),
    createOpportunity: vi.fn(),
    createQuotation: vi.fn(),
    updateOpportunity: vi.fn(),
  };
}

function connection(
  credentialSource: "USER" | "LEGACY",
  writes = writeSpies(),
) {
  return {
    credentialSource,
    client: {
      searchCustomer: vi.fn().mockResolvedValue([]),
      searchProspect: vi.fn().mockResolvedValue([]),
      searchLead: vi.fn().mockResolvedValue([]),
      searchOpportunity: vi.fn().mockResolvedValue([]),
      searchQuotation: vi.fn().mockResolvedValue([]),
      searchProduct: vi.fn().mockResolvedValue([]),
      getCustomer: vi.fn().mockResolvedValue(null),
      getProspect: vi.fn().mockResolvedValue(null),
      getLead: vi.fn().mockResolvedValue(null),
      getOpportunity: vi.fn().mockResolvedValue(null),
      getQuotation: vi.fn().mockResolvedValue(null),
      getProduct: vi.fn().mockResolvedValue(null),
      ...writes,
    },
  };
}

describe("NTOP agent tools", () => {
  beforeEach(() => {
    mocks.configuredNtopConnectionForUser.mockReset();
  });

  it("offers nothing when NTOP is not connected", async () => {
    mocks.configuredNtopConnectionForUser.mockResolvedValue(null);

    expect(await buildNtopTools(context)).toEqual([]);
  });

  it("allows reads but no write proposals on a shared platform key", async () => {
    mocks.configuredNtopConnectionForUser.mockResolvedValue(
      connection("LEGACY"),
    );

    const names = (await buildNtopTools(context)).map((tool) => tool.name);

    expect(names).toEqual(["ntop_search", "ntop_get"]);
  });

  it("adds write proposals only for a personal API key", async () => {
    mocks.configuredNtopConnectionForUser.mockResolvedValue(connection("USER"));

    const tools = await buildNtopTools(context);

    expect(tools.map((tool) => tool.name)).toEqual([
      "ntop_search",
      "ntop_get",
      "ntop_propose_prospect",
      "ntop_propose_lead",
      "ntop_propose_opportunity",
    ]);
    for (const tool of tools.filter((item) => item.access === "WRITE"))
      expect(tool.description).toContain("ห้ามบอกผู้ใช้ว่าบันทึกสำเร็จแล้ว");
  });

  it("returns a proposal without ever calling an NTOP write endpoint", async () => {
    const writes = writeSpies();
    mocks.configuredNtopConnectionForUser.mockResolvedValue(
      connection("USER", writes),
    );
    const tools = await buildNtopTools(context);
    const propose = tools.find(
      (tool) => tool.name === "ntop_propose_prospect",
    )!;

    const result = await propose.execute(context, {
      companyName: "ACME",
      businessPainPoints: "ต้องการ Fix IP",
      expectedBudget: "20000",
    });

    expect(result.isError).toBe(false);
    expect(result.proposal).toMatchObject({
      type: "CREATE_PROSPECT",
      payload: {
        companyName: "ACME",
        source: "MANUAL",
        status: "NEW",
        businessPainPoints: "ต้องการ Fix IP",
        expectedBudget: "20000",
      },
    });
    for (const write of Object.values(writes))
      expect(write).not.toHaveBeenCalled();
  });

  it("refuses a Lead proposal with no way to contact the person", async () => {
    const writes = writeSpies();
    mocks.configuredNtopConnectionForUser.mockResolvedValue(
      connection("USER", writes),
    );
    const propose = (await buildNtopTools(context)).find(
      (tool) => tool.name === "ntop_propose_lead",
    )!;

    const result = await propose.execute(context, {
      company: "ACME",
      contactName: "สมชาย",
    });

    expect(result).toMatchObject({
      isError: true,
      errorCode: "NTOP_LEAD_CONTACT_REQUIRED",
    });
    expect(result.proposal).toBeUndefined();
    expect(writes.createLead).not.toHaveBeenCalled();
  });

  it("reports an NTOP outage instead of inventing records", async () => {
    const broken = connection("USER");
    broken.client.searchCustomer.mockRejectedValue(new Error("ECONNRESET"));
    mocks.configuredNtopConnectionForUser.mockResolvedValue(broken);
    const search = (await buildNtopTools(context)).find(
      (tool) => tool.name === "ntop_search",
    )!;

    const result = await search.execute(context, {
      kind: "CUSTOMER",
      query: "ACME",
    });

    expect(result).toMatchObject({
      isError: true,
      errorCode: "NTOP_UNAVAILABLE",
    });
    expect(result.evidence).toEqual([]);
  });

  it("survives the catalog build, which the api__ prefix guard used to reject", async () => {
    mocks.configuredNtopConnectionForUser.mockResolvedValue(connection("USER"));

    // The guard exists for tenant-chosen names. These five are literals in the
    // repository, so requiring the prefix of them broke every turn as soon as a
    // user connected NTOP — the first end-to-end path this suite did not cover.
    const catalog = buildToolCatalog({
      scope: "SMART",
      databaseToolsEnabled: true,
      apiToolsEnabled: true,
      webSearchRequested: false,
      toolMode: "SEPARATE",
      dynamicTools: await buildNtopTools(context),
    });

    expect([...catalog.keys()]).toEqual(
      expect.arrayContaining([
        "ntop_search",
        "ntop_get",
        "ntop_propose_prospect",
        "ntop_propose_lead",
        "ntop_propose_opportunity",
      ]),
    );
  });
});
