import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findFirst: vi.fn(),
  transaction: vi.fn(),
  requireRackAccess: vi.fn(),
  deleteMany: vi.fn(),
  createAuditLog: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: {
    knowledgeRack: { findFirst: mocks.findFirst },
    $transaction: mocks.transaction,
  },
}));

vi.mock("@/server/auth/knowledge-access", () => ({
  requireKnowledgeRackAccess: mocks.requireRackAccess,
}));

import { deleteKnowledgeFolder } from "@/server/services/unified-source-service";
import type { AuthorizationContext } from "@/server/auth/authorization";

const context = {
  organizationId: "org-1",
  workspaceId: "workspace-1",
  userId: "user-1",
} as AuthorizationContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleteKnowledgeFolder", () => {
  it("refuses to delete a folder that contains a document", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "rack-1",
      name: "General Knowledge",
      sources: [
        {
          _count: { documents: 1 },
        },
      ],
      _count: { sources: 1 },
    });

    const result = await deleteKnowledgeFolder(
      context,
      "rack-1",
      "General Knowledge",
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("CONFLICT");
      expect(result.error.diagnostics?.documentCount).toBe(1);
    }
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("deletes an empty folder with an atomic no-documents guard", async () => {
    mocks.findFirst.mockResolvedValue({
      id: "rack-empty",
      name: "Empty folder",
      sources: [{ _count: { documents: 0 } }],
      _count: { sources: 1 },
    });
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    mocks.createAuditLog.mockResolvedValue({ id: "audit-1" });
    mocks.transaction.mockImplementation(async (callback) =>
      callback({
        knowledgeRack: { deleteMany: mocks.deleteMany },
        auditLog: { create: mocks.createAuditLog },
      }),
    );

    const result = await deleteKnowledgeFolder(
      context,
      "rack-empty",
      "Empty folder",
    );

    expect(result).toEqual({
      ok: true,
      data: { deleted: true, id: "rack-empty" },
    });
    expect(mocks.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "rack-empty",
        sources: { none: { documents: { some: {} } } },
      },
    });
  });
});
