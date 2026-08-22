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

import {
  hasExplicitNtopLookup,
  orchestrateNtopChat,
} from "@/server/services/ntop-chat-orchestrator";

describe("NTOP chat orchestration", () => {
  beforeEach(() => {
    mocks.configuredNtopConnectionForUser.mockReset();
    mocks.configuredNtopConnectionForUser.mockResolvedValue(null);
  });

  it("detects explicit NTOP reads without treating writes as reads", () => {
    expect(hasExplicitNtopLookup("ช่วยหาข้อมูล ธกศ จาก NTOP")).toBe(true);
    expect(hasExplicitNtopLookup("search prospects in NTOP")).toBe(true);
    expect(hasExplicitNtopLookup("ช่วยสร้าง prospect ใน NTOP")).toBe(false);
    expect(hasExplicitNtopLookup("NTOP เชื่อมต่ออยู่ไหม")).toBe(false);
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

  it("answers a Prospect lookup deterministically from NTOP records", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect: vi.fn().mockResolvedValue([
          {
            prospectCode: "PR-001",
            companyName: "ธกศ",
            status: "NEW",
          },
        ]),
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยค้นให้หน่อย ตอนนี้ลูกค้า ธกศ มี prospect อะไรบ้าง",
    );

    expect(outcome).toMatchObject({ toolUsed: true });
    expect(outcome.message).toContain("พบ PROSPECT ของ ธกศ");
    expect(outcome.message).toContain("PR-001 · ธกศ · NEW");
  });

  it("normalizes dotted Thai abbreviations before searching NTOP", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProspect = vi.fn(async (query: string) =>
      query === "ธกศ"
        ? [
            {
              prospectCode: "PR-001",
              companyName: "ธกศ",
              status: "NEW",
            },
          ]
        : [],
    );
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยค้นให้หน่อย ตอนนี้ลูกค้า ธ.ก.ศ มี prospect อะไรบ้าง",
    );

    expect(searchProspect).toHaveBeenCalledWith("ธ.ก.ศ");
    expect(searchProspect).toHaveBeenCalledWith("ธกศ");
    expect(outcome.message).toContain("PR-001 · ธกศ · NEW");
  });

  it("searches each alternative company name in an NTOP lookup", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProspect = vi.fn(async (query: string) =>
      query === "ธกศ"
        ? [
            {
              prospectCode: "PR-001",
              companyName: "ธกศ",
              status: "NEW",
            },
          ]
        : [],
    );
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยค้นให้หน่อย ตอนนี้ลูกค้า ธกศ หรือ ธ.ก.ส. มี prospect อะไรบ้าง",
    );

    expect(searchProspect).toHaveBeenCalledWith("ธกศ");
    expect(searchProspect).toHaveBeenCalledWith("ธ.ก.ส");
    expect(searchProspect).toHaveBeenCalledWith("ธกส");
    expect(outcome.message).toContain("PR-001 · ธกศ · NEW");
  });

  it("routes a generic Prospect category filter to NTOP", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProspect = vi.fn(async (query: string) =>
      query === "ธนาคาร"
        ? [
            {
              prospectCode: "PR-001",
              companyName: "ธกศ",
              status: "NEW",
              industry: { name: "ธนาคาร" },
            },
          ]
        : [],
    );
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "หาลูกค้า prospect ที่เป็น ธนาคาร",
    );

    expect(searchProspect).toHaveBeenCalledWith("ธนาคาร");
    expect(outcome).toMatchObject({ toolUsed: true });
    expect(outcome.message).toContain("พบ PROSPECT ที่ตรงกับ “ธนาคาร” ใน NTOP");
    expect(outcome.message).toContain("PR-001 · ธกศ · NEW");
  });

  it("uses NTOP exclusively when the user explicitly selects it", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProspect = vi.fn(async (query: string) =>
      query === "ธกศ"
        ? [
            {
              prospectCode: "PR-001",
              companyName: "ธกศ",
              status: "NEW",
            },
          ]
        : [],
    );
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยหาข้อมูล ธกศ จาก NTOP",
    );

    expect(emptySearch).toHaveBeenCalledWith("ธกศ");
    expect(searchProspect).toHaveBeenCalledWith("ธกศ");
    expect(outcome).toMatchObject({ toolUsed: true });
    expect(outcome.message).toContain("PROSPECT: 1");
    expect(outcome.evidence).toHaveLength(1);
  });

  it("asks for an NTOP query instead of falling back to documents", async () => {
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

    const outcome = await orchestrateNtopChat("user-1", "ช่วยค้นจาก NTOP");

    expect(outcome).toMatchObject({ toolUsed: true, evidence: [] });
    expect(outcome.message).toContain("กรุณาระบุ");
    expect(emptySearch).not.toHaveBeenCalled();
  });

  it("parses an NTOP category filter without spaces before the source", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProspect = vi
      .fn()
      .mockResolvedValue([
        { prospectCode: "PR-001", companyName: "ธกศ", status: "NEW" },
      ]);
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "หา prospect ที่เป็นธนาคารจาก NTOP",
    );

    expect(searchProspect).toHaveBeenCalledWith("ธนาคาร");
    expect(outcome.message).toContain("PR-001 · ธกศ · NEW");
  });

  it("looks up products when the user explicitly asks for products", async () => {
    const emptySearch = vi.fn().mockResolvedValue([]);
    const searchProduct = vi
      .fn()
      .mockResolvedValue([
        { productCode: "FIX-IP", name: "Fixed IP", status: "ACTIVE" },
      ]);
    mocks.configuredNtopConnectionForUser.mockResolvedValue({
      credentialSource: "USER",
      client: {
        searchCustomer: emptySearch,
        searchProspect: emptySearch,
        searchLead: emptySearch,
        searchOpportunity: emptySearch,
        searchQuotation: emptySearch,
        searchProduct,
      },
    });

    const outcome = await orchestrateNtopChat(
      "user-1",
      "ช่วยค้น product ของลูกค้า ABC ให้หน่อย",
    );

    expect(searchProduct).toHaveBeenCalledWith("ABC");
    expect(outcome.message).toContain("FIX-IP · Fixed IP · ACTIVE");
  });
});
