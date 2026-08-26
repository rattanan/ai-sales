import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authorizeResource: vi.fn(),
  requireBotUse: vi.fn(),
  retrieveBotContext: vi.fn(),
  proposeDatabaseQuery: vi.fn(),
  executeDatabaseQuery: vi.fn(),
  botDataSourceFindMany: vi.fn(),
  dataSourceFindMany: vi.fn(),
}));

vi.mock("@/server/auth/resource-authorization", () => ({
  authorizeResource: mocks.authorizeResource,
}));
vi.mock("@/server/auth/knowledge-access", () => ({
  requireBotUse: mocks.requireBotUse,
}));
vi.mock("@/server/services/retrieval-service", () => ({
  retrieveBotContext: mocks.retrieveBotContext,
  sanitizeRetrievedContent: (value: string) => value,
  lexicalOverlap: () => 1,
}));
vi.mock("@/server/services/database-intelligence-service", () => ({
  proposeDatabaseQuery: mocks.proposeDatabaseQuery,
  executeDatabaseQuery: mocks.executeDatabaseQuery,
}));
vi.mock("@/server/db", () => ({
  db: {
    botDataSource: { findMany: mocks.botDataSourceFindMany },
    dataSource: { findMany: mocks.dataSourceFindMany },
  },
}));

import { searchDocuments } from "@/server/ai/agent/system-tools/documents";
import {
  listDataSources,
  queryDatabase,
} from "@/server/ai/agent/system-tools/database";
import { executeToolCall } from "@/server/ai/agent/tool-executor";
import type { AgentRunContext } from "@/server/ai/agent/types";

function contextFor(organizationId: string, userId: string): AgentRunContext {
  return {
    authorization: {
      userId,
      organizationId,
      workspaceId: `${organizationId}-ws`,
      role: "VIEWER",
    },
    botId: "bot-1",
    conversationId: "conv-1",
    currentMessageId: "msg-1",
    userMessage: "ยอดขาย",
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
}

const tenantA = contextFor("org-a", "user-a");
const tenantB = contextFor("org-b", "user-b");

describe("agent tool authorization", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireBotUse.mockResolvedValue(undefined);
    mocks.retrieveBotContext.mockResolvedValue([]);
    mocks.botDataSourceFindMany.mockResolvedValue([]);
    mocks.dataSourceFindMany.mockResolvedValue([]);
  });

  it("refuses document search when the user may not use the bot", async () => {
    mocks.requireBotUse.mockRejectedValue(new Error("FORBIDDEN"));

    expect(await searchDocuments.authorize(tenantA, { query: "นโยบาย" })).toBe(
      false,
    );
  });

  it("stops an unauthorized tool at the executor even when the model picks it", async () => {
    mocks.requireBotUse.mockRejectedValue(new Error("FORBIDDEN"));

    const executed = await executeToolCall({
      context: tenantA,
      catalog: new Map([["search_documents", searchDocuments]]),
      call: {
        id: "call-1",
        name: "search_documents",
        arguments: { query: "นโยบาย" },
      },
      stepIndex: 0,
      evidenceOffset: 0,
    });

    expect(executed.trace.errorCode).toBe("TOOL_FORBIDDEN");
    expect(executed.result.isError).toBe(true);
    // Denial must happen before the tool body runs.
    expect(mocks.retrieveBotContext).not.toHaveBeenCalled();
  });

  it("hides a data source the user has no USE grant for", async () => {
    mocks.botDataSourceFindMany.mockResolvedValue([
      { dataSource: { id: "ds-1", name: "Sales DB", type: "POSTGRESQL" } },
    ]);
    mocks.authorizeResource.mockResolvedValue({ allowed: false });

    const result = await listDataSources.execute(tenantA, {});

    expect(result.content).toContain("ยังไม่มีฐานข้อมูล");
    expect(result.content).not.toContain("Sales DB");
  });

  it("refuses a query against a data source outside the caller's grants", async () => {
    mocks.botDataSourceFindMany.mockResolvedValue([
      { dataSource: { id: "ds-1", name: "Sales DB", type: "POSTGRESQL" } },
    ]);
    mocks.authorizeResource.mockResolvedValue({ allowed: false });

    const allowed = await queryDatabase.authorize(tenantA, {
      dataSourceId: "ds-1",
      question: "ยอดขายเดือนนี้",
    });
    const result = await queryDatabase.execute(tenantA, {
      dataSourceId: "ds-1",
      question: "ยอดขายเดือนนี้",
    });

    expect(allowed).toBe(false);
    expect(result.errorCode).toBe("DATA_SOURCE_NOT_ACCESSIBLE");
    expect(mocks.proposeDatabaseQuery).not.toHaveBeenCalled();
  });

  it("refuses a data source id that belongs to another tenant", async () => {
    // Tenant A owns ds-1; tenant B's lookup returns nothing for it.
    mocks.botDataSourceFindMany.mockImplementation(
      async ({ where }: { where: { bot: { organizationId: string } } }) =>
        where.bot.organizationId === "org-a"
          ? [{ dataSource: { id: "ds-1", name: "Sales DB", type: "POSTGRESQL" } }]
          : [],
    );
    mocks.authorizeResource.mockResolvedValue({ allowed: true });

    expect(
      await queryDatabase.authorize(tenantA, {
        dataSourceId: "ds-1",
        question: "ยอดขาย",
      }),
    ).toBe(true);
    expect(
      await queryDatabase.authorize(tenantB, {
        dataSourceId: "ds-1",
        question: "ยอดขาย",
      }),
    ).toBe(false);
  });

  it("scopes every data source lookup by the session workspace", async () => {
    mocks.authorizeResource.mockResolvedValue({ allowed: true });

    await listDataSources.execute(tenantB, {});

    expect(mocks.botDataSourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bot: expect.objectContaining({ organizationId: "org-b" }),
        }),
      }),
    );
    expect(mocks.dataSourceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ workspaceId: "org-b-ws" }),
      }),
    );
  });
});
