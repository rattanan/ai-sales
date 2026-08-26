import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getAuthorizationContext: vi.fn(),
  requirePermission: vi.fn(),
  authenticateExternalSession: vi.fn(),
}));

vi.mock("@/server/db", () => ({
  db: { chatMessageArtifact: { findUnique: mocks.findUnique } },
}));
vi.mock("@/server/auth/authorization", () => ({
  getAuthorizationContext: mocks.getAuthorizationContext,
}));
vi.mock("@/server/auth/permissions", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/server/auth/embedded-auth", () => ({
  bearerToken: (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/, "") ?? null,
  authenticateExternalSession: mocks.authenticateExternalSession,
}));

import { GET } from "@/app/api/chat-artifacts/[id]/route";

const artifactId = "00000000-0000-4000-8000-000000000001";
const metadata = {
  kind: "image",
  mediaType: "image/png",
  message: {
    conversationId: "conversation-1",
    conversation: {
      organizationId: "org-1",
      userId: "user-1",
      botId: "bot-1",
      deletedAt: null,
    },
  },
};

function request(headers?: HeadersInit) {
  return GET(
    new Request(`https://app.example.com/api/chat-artifacts/${artifactId}`, {
      headers,
    }),
    {
      params: Promise.resolve({ id: artifactId }),
    },
  );
}

describe("chat artifact image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockReset();
    mocks.findUnique
      .mockResolvedValueOnce(metadata)
      .mockResolvedValueOnce({ mediaBytes: new Uint8Array([1, 2, 3]) });
    mocks.getAuthorizationContext.mockResolvedValue({
      organizationId: "org-1",
      userId: "user-1",
    });
    mocks.requirePermission.mockResolvedValue(undefined);
  });

  it("serves bytes only after the owning user passes chat authorization", async () => {
    const response = await request();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
    expect(mocks.requirePermission).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user-1" }),
      "chat.use",
    );
  });

  it("does not read media bytes for another user", async () => {
    mocks.getAuthorizationContext.mockResolvedValue({
      organizationId: "org-1",
      userId: "user-2",
    });

    const response = await request();

    expect(response.status).toBe(404);
    expect(mocks.findUnique).toHaveBeenCalledTimes(1);
  });

  it("accepts only an embedded token bound to the same conversation", async () => {
    mocks.authenticateExternalSession.mockResolvedValue({
      externalSession: {
        conversationId: "conversation-1",
        organizationId: "org-1",
      },
    });

    const response = await request({ authorization: "Bearer widget-token" });

    expect(response.status).toBe(200);
    expect(mocks.authenticateExternalSession).toHaveBeenCalledWith(
      "widget-token",
      "bot-1",
    );
    expect(mocks.getAuthorizationContext).not.toHaveBeenCalled();
  });
});
