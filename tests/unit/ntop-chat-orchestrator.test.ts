import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configuredNtopConnectionForUser: vi.fn(),
}));

vi.mock("@/server/integrations/ntop/client", () => ({
  configuredNtopConnectionForUser: mocks.configuredNtopConnectionForUser,
}));

vi.mock("@/server/ai/factory", () => ({
  createAIProvider: () => ({
    generateStructuredOutput: vi.fn().mockRejectedValue(new Error("offline")),
  }),
}));

import { orchestrateNtopChat } from "@/server/services/ntop-chat-orchestrator";

describe("NTOP chat orchestration", () => {
  beforeEach(() => {
    mocks.configuredNtopConnectionForUser.mockReset();
    mocks.configuredNtopConnectionForUser.mockResolvedValue(null);
  });

  it("surfaces missing NTOP configuration instead of silently falling through", async () => {
    const outcome = await orchestrateNtopChat(
      "user-1",
      "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
    );

    expect(outcome).toMatchObject({
      toolUsed: true,
      toolErrorCode: "NTOP_NOT_CONFIGURED",
    });
    expect(outcome.warning).toContain("ธกศ.");
  });

  it("uses recent user context for an explicit Prospect follow-up", async () => {
    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยสร้างเป็น Prospect ให้ที",
      {
        contextMessages: [
          "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
        ],
      },
    );

    expect(outcome).toMatchObject({
      toolUsed: true,
      toolErrorCode: "NTOP_NOT_CONFIGURED",
    });
    expect(outcome.warning).toContain("ธกศ.");
  });

  it("proactively proposes a Prospect for a described customer need", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect: emptySearch,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
    );

    expect(outcome.action).toMatchObject({
      type: "CREATE_PROSPECT",
      payload: {
        companyName: "ธกศ.",
        recommendedProducts: "Fix IP",
        expectedBudget: "10000",
      },
    });
  });

  it("proposes a Prospect with resolved context when NTOP is connected", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect: emptySearch,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยสร้างเป็น Prospect ให้ที",
      {
        contextMessages: [
          "ลูกค้า ธกศ. มีงบ 10000 บาทต่อเดือนต้องการใช้ Fix IP ช่วยแนะนำหน่อย",
        ],
      },
    );

    expect(outcome.action).toMatchObject({
      type: "CREATE_PROSPECT",
      payload: {
        companyName: "ธกศ.",
        recommendedProducts: "Fix IP",
        expectedBudget: "10000",
      },
    });
  });
});
