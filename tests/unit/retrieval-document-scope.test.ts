import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthorizationContext } from "@/server/auth/authorization";

const mocks = vi.hoisted(() => ({
  requireBotUse: vi.fn(),
  authorizeResource: vi.fn(),
  embedKnowledgeQuery: vi.fn(),
  botFindFirst: vi.fn(),
  rackFindMany: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock("@/server/auth/knowledge-access", () => ({
  requireBotUse: mocks.requireBotUse,
}));
vi.mock("@/server/auth/resource-authorization", () => ({
  authorizeResource: mocks.authorizeResource,
}));
vi.mock("@/server/services/embedding-service", () => ({
  embedKnowledgeQuery: mocks.embedKnowledgeQuery,
}));
vi.mock("@/server/db", () => ({
  db: {
    bot: { findFirst: mocks.botFindFirst },
    knowledgeRack: { findMany: mocks.rackFindMany },
    $queryRawUnsafe: mocks.queryRawUnsafe,
  },
}));

import { retrieveBotContext } from "@/server/services/retrieval-service";

describe("document-scoped retrieval", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireBotUse.mockResolvedValue(undefined);
    mocks.botFindFirst.mockResolvedValue({ providerConfig: null });
    mocks.rackFindMany.mockResolvedValue([{ id: "rack-1" }]);
    mocks.authorizeResource.mockResolvedValue({ allowed: true });
    mocks.embedKnowledgeQuery.mockRejectedValue(new Error("offline"));
    mocks.queryRawUnsafe.mockResolvedValue([]);
  });

  it("passes selected document ids into the ACL-constrained query", async () => {
    const context = {
      userId: "user-1",
      organizationId: "organization-1",
      workspaceId: "workspace-1",
      role: "VIEWER",
    } as AuthorizationContext;

    await retrieveBotContext(context, "bot-1", "quarterly target", {
      allAccessible: true,
      documentIds: ["document-q1"],
    });

    expect(mocks.queryRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining("OR d.id = ANY($7::text[])"),
      "bot-1",
      "organization-1",
      ["rack-1"],
      "quarterly target",
      true,
      [],
      ["document-q1"],
    );
  });
});
