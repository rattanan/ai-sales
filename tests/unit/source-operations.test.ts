import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configureSchedule: vi.fn(),
  enqueueRefresh: vi.fn(),
  events: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/auth/knowledge-access", () => ({
  requireKnowledgeRackAccess: vi.fn(),
}));
vi.mock("@/schemas/env", () => ({
  env: () => ({
    GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON: "{}",
    KNOWLEDGE_SHARED_FOLDER_MAX_FILES: 10_000,
    KNOWLEDGE_SHARED_FOLDER_ROOTS: "",
  }),
}));
vi.mock("@/server/services/job-queue", () => ({
  configureSourceRefreshSchedule: mocks.configureSchedule,
  enqueueDocumentIndexJob: vi.fn(),
  enqueueSourceRefreshJob: mocks.enqueueRefresh,
}));
vi.mock("@/server/db", () => {
  const transactionClient = {
    knowledgeSource: {
      create: vi.fn().mockResolvedValue({ id: "source-1", name: "Drive" }),
    },
    auditLog: { create: vi.fn().mockResolvedValue({}) },
  };
  return {
    db: {
      knowledgeRack: {
        findUnique: vi.fn().mockResolvedValue({ scope: "GLOBAL", bots: [] }),
      },
      knowledgeSource: {
        findFirst: vi.fn().mockResolvedValue({
          id: "source-1",
          name: "Drive",
          rackId: "rack-1",
          type: "SHARED_FOLDER",
        }),
      },
      sourceRefreshRun: {
        count: vi.fn().mockResolvedValue(0),
        create: vi.fn().mockResolvedValue({ id: "refresh-1" }),
        update: vi.fn().mockResolvedValue({}),
      },
      auditLog: { create: vi.fn().mockResolvedValue({}) },
      $transaction: vi.fn((callback: (tx: typeof transactionClient) => unknown) =>
        callback(transactionClient),
      ),
    },
  };
});

import { createSharedFolderSource } from "@/server/services/source-operations";

describe("createSharedFolderSource", () => {
  beforeEach(() => {
    mocks.events.length = 0;
    mocks.enqueueRefresh.mockReset().mockImplementation(async () => {
      mocks.events.push("initial-refresh");
      return "queue-job-1";
    });
    mocks.configureSchedule.mockReset().mockImplementation(async () => {
      mocks.events.push("schedule");
    });
  });

  it("queues the initial refresh before enabling a recurring schedule", async () => {
    const result = await createSharedFolderSource(
      {
        organizationId: "organization-1",
        workspaceId: "workspace-1",
        userId: "user-1",
      } as never,
      {
        rackId: "rack-1",
        name: "Drive",
        rootPath: "https://drive.google.com/drive/folders/folder-1",
        includeSubdirectories: true,
        scheduleEnabled: true,
        intervalMinutes: 60,
        maxFiles: 10_000,
      },
    );

    expect(result.ok).toBe(true);
    expect(mocks.events).toEqual(["initial-refresh", "schedule"]);
  });
});
