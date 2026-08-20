import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  revalidatePath: vi.fn(),
  createSource: vi.fn(),
  countBots: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/authorization", () => ({
  requireAuthorization: vi.fn().mockResolvedValue({
    organizationId: "organization-1",
    workspaceId: "workspace-1",
    userId: "user-1",
  }),
}));
vi.mock("@/server/auth/knowledge-access", () => ({
  requireKnowledgeRackAccess: vi.fn(),
}));
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: vi.fn(),
}));
vi.mock("@/server/db", () => ({
  db: {
    bot: { count: mocks.countBots },
    knowledgeSource: { create: mocks.createSource },
  },
}));
vi.mock("@/server/services/source-operations", () => ({
  createSharedFolderSource: vi.fn(),
  createWebSource: vi.fn(),
}));
vi.mock("@/server/services/unified-source-service", () => ({
  saveCopiedTextSource: vi.fn(),
  updateSourceAssignment: vi.fn(),
}));

import { addKnowledgeAction } from "@/features/knowledge/add-knowledge-action";

describe("addKnowledgeAction file source", () => {
  beforeEach(() => {
    mocks.revalidatePath.mockReset();
    mocks.countBots.mockReset().mockResolvedValue(0);
    mocks.createSource.mockReset().mockResolvedValue({ id: "source-1" });
  });

  it("does not revalidate and remount the wizard before the file upload", async () => {
    const formData = new FormData();
    formData.set("kind", "FILE");
    formData.set("rackId", "rack-1");
    formData.set("name", "Employee handbook");
    formData.set("scope", "GLOBAL");
    formData.set("fileName", "handbook.pdf");

    await expect(addKnowledgeAction(null, formData)).resolves.toEqual({
      ok: true,
      data: { id: "source-1", uploadRequired: true },
    });
    expect(mocks.createSource).toHaveBeenCalledTimes(1);
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
