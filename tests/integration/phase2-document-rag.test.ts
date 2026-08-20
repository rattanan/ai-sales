import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";
import type { AuthorizationContext } from "@/server/auth/authorization";
import { processDocumentIndexJob } from "@/packages/knowledge/index-document";
import { retrieveBotContext } from "@/server/services/retrieval-service";
import { sendKnowledgeChatMessage } from "@/server/services/chat-service";
import type { WorkerEnvironment } from "@/schemas/worker-env";

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = connectionString
  ? new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    })
  : null;

afterEach(() => vi.restoreAllMocks());
afterAll(async () => prisma?.$disconnect());

describe.skipIf(!connectionString)("Phase 2 governed document RAG", () => {
  it("filters inaccessible rack chunks before retrieval and isolates chat history", async () => {
    const suffix = crypto.randomUUID();
    const [userA, userB] = await Promise.all([
      prisma!.user.create({
        data: {
          email: `phase2-a-${suffix}@example.test`,
          username: `phase2-a-${suffix}`,
          status: "ACTIVE",
        },
      }),
      prisma!.user.create({
        data: {
          email: `phase2-b-${suffix}@example.test`,
          username: `phase2-b-${suffix}`,
          status: "ACTIVE",
        },
      }),
    ]);
    const organization = await prisma!.organization.create({
      data: { name: "Phase 2 ACL", slug: `phase2-${suffix}` },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: userA.id,
        name: "Phase 2",
        slug: "phase-2",
      },
    });
    await prisma!.organizationMember.createMany({
      data: [
        { organizationId: organization.id, userId: userA.id, role: "VIEWER" },
        { organizationId: organization.id, userId: userB.id, role: "VIEWER" },
      ],
    });
    const role = await prisma!.role.create({
      data: {
        organizationId: organization.id,
        name: "Knowledge user",
        systemKey: `KNOWLEDGE_${suffix}`,
      },
    });
    for (const key of ["bot.use", "knowledge.view", "chat.use"]) {
      const permission = await prisma!.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma!.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    await prisma!.userRole.createMany({
      data: [
        { organizationId: organization.id, userId: userA.id, roleId: role.id },
        { organizationId: organization.id, userId: userB.id, roleId: role.id },
      ],
    });
    const bot = await prisma!.bot.create({
      data: {
        organizationId: organization.id,
        createdById: userA.id,
        name: "Governed assistant",
        systemPrompt:
          "Answer only from governed evidence supplied by the system.",
        welcomeMessage: "Ask a question",
        active: true,
        access: {
          create: {
            organizationId: organization.id,
            roleId: role.id,
            level: "USE",
          },
        },
      },
    });
    const rack = await prisma!.knowledgeRack.create({
      data: {
        organizationId: organization.id,
        createdById: userA.id,
        name: "Restricted policies",
        access: {
          create: {
            organizationId: organization.id,
            userId: userA.id,
            level: "READ",
          },
        },
        sources: { create: { name: "Files" } },
        bots: { create: { botId: bot.id } },
      },
      include: { sources: true },
    });
    const document = await prisma!.document.create({
      data: {
        organizationId: organization.id,
        sourceId: rack.sources[0].id,
        createdById: userA.id,
        name: "restricted-policy.txt",
        mimeType: "text/plain",
        checksum: suffix.replaceAll("-", ""),
      },
    });
    const version = await prisma!.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        storageKey: crypto.randomUUID(),
        size: 36,
        checksum: document.checksum,
        mimeType: "text/plain",
        uploadedById: userA.id,
        status: "INDEXED",
      },
    });
    await prisma!.documentChunk.create({
      data: {
        documentVersionId: version.id,
        ordinal: 0,
        content:
          "The restricted retention period is seven years. ระยะเวลาเก็บรักษาคือเจ็ดปี",
        contentHash: `hash-${suffix}`,
        tokenCount: 12,
        metadata: { page: 7, section: 2 },
      },
    });
    await prisma!.document.update({
      where: { id: document.id },
      data: { currentVersionId: version.id },
    });
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("embedding provider intentionally unavailable"),
    );
    const contextA: AuthorizationContext = {
      userId: userA.id,
      organizationId: organization.id,
      workspaceId: workspace.id,
      role: "VIEWER",
    };
    const contextB: AuthorizationContext = { ...contextA, userId: userB.id };
    expect(
      await retrieveBotContext(contextA, bot.id, "retention period"),
    ).toEqual([
      expect.objectContaining({
        documentId: document.id,
        metadata: { page: 7, section: 2 },
      }),
    ]);
    expect(
      await retrieveBotContext(contextA, bot.id, "ระยะเวลาเก็บรักษา"),
    ).toEqual([expect.objectContaining({ documentId: document.id })]);
    expect(
      await retrieveBotContext(contextB, bot.id, "retention period"),
    ).toEqual([]);

    const conversationA = await prisma!.conversation.create({
      data: {
        organizationId: organization.id,
        botId: bot.id,
        userId: userA.id,
        title: "Private history",
      },
    });
    const crossUser = await sendKnowledgeChatMessage(contextB, {
      botId: bot.id,
      conversationId: conversationA.id,
      message: "Read another user's history",
    });
    expect(crossUser).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    const noEvidence = await sendKnowledgeChatMessage(contextB, {
      botId: bot.id,
      message: "What is the restricted retention period?",
    });
    expect(noEvidence).toMatchObject({
      ok: true,
      data: {
        assistantMessage: {
          errorCode: "NO_GROUNDED_CONTEXT",
          citations: [],
        },
      },
    });

    await prisma!.organization.delete({ where: { id: organization.id } });
    await prisma!.user.deleteMany({
      where: { id: { in: [userA.id, userB.id] } },
    });
  });

  it("indexes idempotently and completes a grounded Thai chat with a source citation", async () => {
    const suffix = crypto.randomUUID();
    const storageRoot = await mkdtemp(path.join(tmpdir(), "insightkm-phase2-"));
    const user = await prisma!.user.create({
      data: {
        email: `phase2-worker-${suffix}@example.test`,
        username: `phase2-worker-${suffix}`,
        status: "ACTIVE",
      },
    });
    const organization = await prisma!.organization.create({
      data: { name: "Phase 2 Worker", slug: `phase2-worker-${suffix}` },
    });
    const workspace = await prisma!.workspace.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Knowledge workspace",
        slug: "knowledge",
      },
    });
    await prisma!.organizationMember.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        role: "VIEWER",
      },
    });
    const role = await prisma!.role.create({
      data: {
        organizationId: organization.id,
        name: "Knowledge chat user",
        systemKey: `CHAT_${suffix}`,
      },
    });
    for (const key of ["bot.use", "knowledge.view", "chat.use"]) {
      const permission = await prisma!.permission.upsert({
        where: { key },
        update: {},
        create: { key },
      });
      await prisma!.rolePermission.create({
        data: { roleId: role.id, permissionId: permission.id },
      });
    }
    await prisma!.userRole.create({
      data: {
        organizationId: organization.id,
        userId: user.id,
        roleId: role.id,
      },
    });
    const rack = await prisma!.knowledgeRack.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Worker fixtures",
        sources: { create: { name: "Files" } },
        access: {
          create: {
            organizationId: organization.id,
            userId: user.id,
            level: "READ",
          },
        },
      },
      include: { sources: true },
    });
    const bot = await prisma!.bot.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Leave assistant",
        systemPrompt: "Answer only from the supplied governed evidence.",
        welcomeMessage: "Ask about leave",
        active: true,
        access: {
          create: {
            organizationId: organization.id,
            userId: user.id,
            level: "USE",
          },
        },
        knowledgeRacks: { create: { rackId: rack.id } },
        providerConfig: {
          create: { citationEnabled: true, memoryMode: "CONVERSATION" },
        },
      },
    });
    const storageKey = crypto.randomUUID();
    await writeFile(
      path.join(storageRoot, storageKey),
      "นโยบายการลาอนุญาตให้ลาพักร้อน 10 วันต่อปี\n\nAnnual leave is 10 days per year.",
    );
    const document = await prisma!.document.create({
      data: {
        organizationId: organization.id,
        sourceId: rack.sources[0].id,
        createdById: user.id,
        name: "leave-policy.txt",
        mimeType: "text/plain",
        checksum: `doc-${suffix}`,
      },
    });
    const version = await prisma!.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        storageKey,
        size: 90,
        checksum: `version-${suffix}`,
        mimeType: "text/plain",
        uploadedById: user.id,
        status: "QUEUED",
      },
    });
    const indexJob = await prisma!.documentIndexJob.create({
      data: {
        documentVersionId: version.id,
        embeddingModel: "test-embedding-v1",
      },
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        input?: string | string[];
      };
      if (String(url).endsWith("/chat/completions"))
        return new Response(
          JSON.stringify({
            choices: [
              { message: { content: "สิทธิลาพักร้อนคือ 10 วันต่อปี [1]" } },
            ],
            usage: { prompt_tokens: 80, completion_tokens: 14 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      const inputs = Array.isArray(body.input)
        ? body.input
        : [body.input ?? ""];
      return new Response(
        JSON.stringify({ embeddings: inputs.map(() => [0.1, 0.2, 0.3]) }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const environment: WorkerEnvironment = {
      DATABASE_URL: connectionString!,
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      CREDENTIAL_KEY_VERSION: "env-v1",
      CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS: "",
      LOCAL_STORAGE_PATH: storageRoot,
      KNOWLEDGE_MAX_UPLOAD_BYTES: 25 * 1024 * 1024,
      KNOWLEDGE_CHUNK_CHARACTERS: 400,
      KNOWLEDGE_CHUNK_OVERLAP: 50,
      KNOWLEDGE_CHUNK_MAX_TOKENS: 400,
      KNOWLEDGE_SHARED_FOLDER_ROOTS: storageRoot,
      KNOWLEDGE_SHARED_FOLDER_MAX_FILES: 10_000,
      KNOWLEDGE_WEB_MAX_BYTES: 5 * 1024 * 1024,
      KNOWLEDGE_WEB_TIMEOUT_MS: 15_000,
      KNOWLEDGE_WEB_MAX_REDIRECTS: 3,
      EMBEDDING_BASE_URL: "http://embedding.test/api/embed",
      EMBEDDING_MODEL: "test-embedding-v1",
      EMBEDDING_TIMEOUT_MS: 5_000,
      AI_MAX_RETRIES: 2,
      EMBEDDING_BATCH_SIZE: 4,
      EMBEDDING_BATCH_CONCURRENCY: 2,
      REDIS_URL: "redis://127.0.0.1:6379/0",
      BULLMQ_PREFIX: "insightkm-test",
      WORKER_CONCURRENCY: 1,
      WORKER_RATE_LIMIT_MAX: 50,
      WORKER_RATE_LIMIT_DURATION_MS: 1_000,
      QUEUE_MAX_WAITING_JOBS: 5_000,
      WORKER_HEALTH_TIMEOUT_MS: 5_000,
    };
    const pool = new Pool({ connectionString });
    try {
      const first = await processDocumentIndexJob(
        indexJob.id,
        pool,
        environment,
      );
      const firstChunks = await prisma!.documentChunk.findMany({
        where: { documentVersionId: version.id },
        select: { contentHash: true },
      });
      await prisma!.$transaction([
        prisma!.documentIndexJob.update({
          where: { id: indexJob.id },
          data: { status: "QUEUED", completedAt: null },
        }),
        prisma!.documentVersion.update({
          where: { id: version.id },
          data: { status: "QUEUED" },
        }),
      ]);
      const retried = await processDocumentIndexJob(
        indexJob.id,
        pool,
        environment,
      );
      const retriedChunks = await prisma!.documentChunk.findMany({
        where: { documentVersionId: version.id },
        select: { contentHash: true },
      });
      expect(first.chunkCount).toBeGreaterThan(0);
      expect(retried.chunkCount).toBe(first.chunkCount);
      expect(retriedChunks).toEqual(firstChunks);
      expect(
        new Set(retriedChunks.map(({ contentHash }) => contentHash)).size,
      ).toBe(retriedChunks.length);
      const chat = await sendKnowledgeChatMessage(
        {
          userId: user.id,
          organizationId: organization.id,
          workspaceId: workspace.id,
          role: "VIEWER",
        },
        { botId: bot.id, message: "สิทธิลาพักร้อนมีกี่วันต่อปี" },
      );
      expect(chat).toMatchObject({
        ok: true,
        data: {
          assistantMessage: {
            content: expect.stringContaining("10 วัน"),
            citations: expect.arrayContaining([
              expect.objectContaining({
                rank: 1,
                metadata: expect.objectContaining({
                  documentId: document.id,
                  documentName: "leave-policy.txt",
                  section: 1,
                }),
              }),
            ]),
          },
        },
      });
    } finally {
      await pool.end();
      await prisma!.organization.delete({ where: { id: organization.id } });
      await prisma!.user.delete({ where: { id: user.id } });
      await rm(storageRoot, { recursive: true, force: true });
    }
  });
});
