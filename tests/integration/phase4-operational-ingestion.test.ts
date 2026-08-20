import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterAll, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { Pool } from "pg";
import { processSourceRefreshJob } from "@/packages/knowledge/refresh-source";
import { workerEnv } from "@/schemas/worker-env";

const connectionString = process.env.TEST_DATABASE_URL;
const prisma = connectionString
  ? new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  : null;

afterAll(async () => prisma?.$disconnect());

describe.skipIf(!connectionString)("Phase 4 operational ingestion", () => {
  it("detects folder additions, unchanged files, changes, and deletions incrementally", async () => {
    const suffix = crypto.randomUUID();
    const mountRoot = await mkdtemp(
      path.join(tmpdir(), "insightkm-phase4-mount-"),
    );
    const storageRoot = await mkdtemp(
      path.join(tmpdir(), "insightkm-phase4-storage-"),
    );
    const pool = new Pool({ connectionString });
    const user = await prisma!.user.create({
      data: {
        email: `phase4-${suffix}@example.test`,
        username: `phase4-${suffix}`,
        status: "ACTIVE",
      },
    });
    const organization = await prisma!.organization.create({
      data: { name: "Phase 4 ingestion", slug: `phase4-${suffix}` },
    });
    const rack = await prisma!.knowledgeRack.create({
      data: {
        organizationId: organization.id,
        createdById: user.id,
        name: "Operational fixtures",
        sources: {
          create: {
            name: "Mounted policies",
            type: "SHARED_FOLDER",
            sharedFolderConfig: {
              create: {
                rootPath: mountRoot,
                includeSubdirectories: true,
                maxFiles: 100,
              },
            },
          },
        },
      },
      include: { sources: true },
    });
    const source = rack.sources[0];
    const queued: string[] = [];
    const environment = workerEnv({
      DATABASE_URL: connectionString!,
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      LOCAL_STORAGE_PATH: storageRoot,
      KNOWLEDGE_SHARED_FOLDER_ROOTS: mountRoot,
      EMBEDDING_MODEL: "phase4-test-embedding",
    });
    const fixture = path.join(mountRoot, "handbook.md");
    try {
      await writeFile(fixture, "Annual leave is ten days.");
      const first = await processSourceRefreshJob(
        { sourceId: source.id, trigger: "MANUAL" },
        pool,
        environment,
        async (id) => {
          queued.push(id);
        },
      );
      expect(first).toMatchObject({
        newCount: 1,
        changedCount: 0,
        deletedCount: 0,
      });
      expect(queued).toHaveLength(1);

      const unchanged = await processSourceRefreshJob(
        { sourceId: source.id, trigger: "MANUAL" },
        pool,
        environment,
        async (id) => {
          queued.push(id);
        },
      );
      expect(unchanged).toMatchObject({
        unchangedCount: 1,
        newCount: 0,
        changedCount: 0,
      });
      expect(queued).toHaveLength(1);

      await writeFile(
        fixture,
        "Annual leave is twelve days after policy revision.",
      );
      const future = new Date(Date.now() + 2_000);
      await utimes(fixture, future, future);
      const changed = await processSourceRefreshJob(
        { sourceId: source.id, trigger: "MANUAL" },
        pool,
        environment,
        async (id) => {
          queued.push(id);
        },
      );
      expect(changed).toMatchObject({ changedCount: 1, newCount: 0 });
      expect(queued).toHaveLength(2);
      expect(
        await prisma!.documentVersion.count({
          where: { document: { sourceId: source.id } },
        }),
      ).toBe(2);

      await rm(fixture);
      const deleted = await processSourceRefreshJob(
        { sourceId: source.id, trigger: "MANUAL" },
        pool,
        environment,
        async (id) => {
          queued.push(id);
        },
      );
      expect(deleted).toMatchObject({ deletedCount: 1 });
      expect(
        await prisma!.document.findFirst({
          where: { sourceId: source.id },
          select: { active: true, sourceDeletedAt: true },
        }),
      ).toMatchObject({ active: false, sourceDeletedAt: expect.any(Date) });
    } finally {
      await prisma!.organization.delete({ where: { id: organization.id } });
      await prisma!.user.delete({ where: { id: user.id } });
      await pool.end();
      await Promise.all([
        rm(mountRoot, { recursive: true, force: true }),
        rm(storageRoot, { recursive: true, force: true }),
      ]);
    }
  });
});
