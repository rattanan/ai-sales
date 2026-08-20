import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import { recoverStaleOperations } from "@/packages/knowledge/recover-operations";
import { shouldSkipWebCrawlError } from "@/packages/knowledge/refresh-source";
import {
  domainAllowed,
  extractMainHtml,
  extractSameDomainLinks,
  isPublicAddress,
  pinnedAddressLookup,
  scanSharedFolder,
  SourceSecurityError,
  validatePublicWebUrl,
  validateSharedFolderPath,
  validateWebRedirect,
} from "@/packages/knowledge/source-security";
import { workerEnv } from "@/schemas/worker-env";

const temporaryPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryPaths
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryPaths.push(directory);
  return directory;
}

describe("Phase 4 shared-folder security and incrementality", () => {
  it("accepts only canonical directories inside an allowlisted root", async () => {
    const root = await temporaryDirectory("insightkm-root-");
    const child = path.join(root, "team");
    const outside = await temporaryDirectory("insightkm-outside-");
    await mkdir(child);
    await expect(validateSharedFolderPath(child, [root])).resolves.toMatch(
      /\/team$/,
    );
    await expect(
      validateSharedFolderPath(outside, [root]),
    ).rejects.toMatchObject({ code: "PATH_NOT_ALLOWED" });
  });

  it("snapshots supported files and reuses the checksum for unchanged metadata", async () => {
    const root = await temporaryDirectory("insightkm-scan-");
    await mkdir(path.join(root, "nested"));
    await writeFile(path.join(root, "policy.md"), "annual leave: 10 days");
    await writeFile(path.join(root, "nested", "ignored.bin"), "binary");
    const first = await scanSharedFolder({
      rootPath: root,
      allowedRoots: [root],
      includeSubdirectories: true,
      maxFiles: 10,
      maxFileBytes: 1_000,
    });
    expect(first.files).toHaveLength(1);
    expect(first.files[0].locator).toBe("policy.md");
    const second = await scanSharedFolder({
      rootPath: root,
      allowedRoots: [root],
      includeSubdirectories: true,
      maxFiles: 10,
      maxFileBytes: 1_000,
      previous: new Map([
        [
          "policy.md",
          {
            size: first.files[0].size,
            modifiedAt: first.files[0].modifiedAt,
            checksum: "cached-checksum",
          },
        ],
      ]),
    });
    expect(second.files[0].checksum).toBe("cached-checksum");
  });

  it("rejects symbolic links, including links that escape the mount", async () => {
    const root = await temporaryDirectory("insightkm-symlink-");
    const outside = await temporaryDirectory("insightkm-target-");
    await writeFile(path.join(outside, "secret.md"), "secret");
    await symlink(
      path.join(outside, "secret.md"),
      path.join(root, "linked.md"),
    );
    await expect(
      scanSharedFolder({
        rootPath: root,
        allowedRoots: [root],
        includeSubdirectories: true,
        maxFiles: 10,
        maxFileBytes: 1_000,
      }),
    ).rejects.toBeInstanceOf(SourceSecurityError);
  });
});

describe("Phase 4 web-source SSRF controls", () => {
  it.each([400, 403])(
    "skips child-page HTTP %s without making the refresh partial",
    (status) => {
      const error = new SourceSecurityError(
        "FETCH_FAILED",
        `The web source returned HTTP ${status}.`,
      );

      expect(shouldSkipWebCrawlError(error, 1)).toBe(true);
      expect(shouldSkipWebCrawlError(error, 0)).toBe(false);
    },
  );

  it("keeps other child-page failures visible", () => {
    expect(
      shouldSkipWebCrawlError(
        new SourceSecurityError(
          "FETCH_FAILED",
          "The web source returned HTTP 404.",
        ),
        1,
      ),
    ).toBe(false);
  });

  it("returns the pinned address shape requested by Node networking", async () => {
    const lookup = pinnedAddressLookup("93.184.216.34", 4);

    await expect(
      new Promise((resolve, reject) =>
        lookup("example.com", { all: true }, (error, addresses) => {
          if (error) reject(error);
          else resolve(addresses);
        }),
      ),
    ).resolves.toEqual([{ address: "93.184.216.34", family: 4 }]);

    await expect(
      new Promise((resolve, reject) =>
        lookup("example.com", { all: false }, (error, address, family) => {
          if (error) reject(error);
          else resolve({ address, family });
        }),
      ),
    ).resolves.toEqual({ address: "93.184.216.34", family: 4 });
  });

  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
  ])("blocks non-public address %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it("enforces exact-or-subdomain allowlists", () => {
    expect(domainAllowed("docs.example.com", ["example.com"])).toBe(true);
    expect(domainAllowed("example.com.evil.test", ["example.com"])).toBe(false);
  });

  it("rejects metadata/private targets before making a request", async () => {
    await expect(
      validatePublicWebUrl("http://169.254.169.254/latest/meta-data", [
        "169.254.169.254",
      ]),
    ).rejects.toMatchObject({ code: "PRIVATE_ADDRESS_DENIED" });
  });

  it("revalidates redirects and blocks private-network and allowlist escapes", async () => {
    await expect(
      validateWebRedirect(
        "https://docs.example.com/start",
        "http://169.254.169.254/latest",
        ["docs.example.com"],
      ),
    ).rejects.toMatchObject({ code: "URL_DENIED" });
    await expect(
      validateWebRedirect(
        "https://docs.example.com/start",
        "https://evil.example.test/",
        ["docs.example.com"],
      ),
    ).rejects.toMatchObject({ code: "URL_DENIED" });
  });

  it("removes common page boilerplate and keeps main content", () => {
    const extracted = extractMainHtml(
      "<html><body><nav>menu</nav><main><h1>Policy</h1><p>Ten days</p></main><footer>legal</footer></body></html>",
    );
    expect(extracted).toContain("Ten days");
    expect(extracted).not.toContain("menu");
    expect(extracted).not.toContain("legal");
  });

  it("extracts unique same-host links and ignores other domains", () => {
    const links = extractSameDomainLinks(
      `<main>
        <a href="/guide">Guide</a>
        <a href="https://docs.example.com/guide#intro">Duplicate</a>
        <a href="https://other.example.com/guide">Other host</a>
        <a href="mailto:owner@example.com">Mail</a>
      </main>`,
      "https://docs.example.com/start",
      "docs.example.com",
    );
    expect(links).toEqual(["https://docs.example.com/guide"]);
  });
});

describe("Phase 4 worker recovery and bounded concurrency", () => {
  it("requeues stale index and refresh work and completes stale cancellation", async () => {
    const enqueueIndex = vi.fn().mockResolvedValue(undefined);
    const enqueueRefresh = vi.fn().mockResolvedValue(undefined);
    const query = vi.fn().mockImplementation(async (sql: string) => {
      if (sql.includes("status = 'CANCELLED'"))
        return { rows: [{ id: "cancel-1" }], rowCount: 1 };
      if (sql.includes('RETURNING id, "documentVersionId"'))
        return {
          rows: [{ id: "index-1", documentVersionId: "version-1" }],
          rowCount: 1,
        };
      if (sql.includes('RETURNING id, "sourceId"'))
        return {
          rows: [{ id: "refresh-1", sourceId: "source-1" }],
          rowCount: 1,
        };
      return { rows: [], rowCount: 0 };
    });
    const result = await recoverStaleOperations({ query } as unknown as Pool, {
      staleBefore: new Date(),
      enqueueIndex,
      enqueueRefresh,
    });
    expect(result).toMatchObject({
      indexJobsRecovered: 1,
      refreshRunsRecovered: 1,
      cancellationsCompleted: 1,
      errors: [],
    });
    expect(enqueueIndex).toHaveBeenCalledWith("index-1");
    expect(enqueueRefresh).toHaveBeenCalledWith("source-1", "refresh-1");
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("status = 'QUEUED'\n          AND \"updatedAt\" < $1"),
      ),
    ).toBe(true);
  });

  it("caps worker concurrency at fifty under load-oriented configuration", () => {
    const base = {
      DATABASE_URL:
        "postgresql://test:test@database.example.test:5432/insightkm",
      CREDENTIAL_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    };
    expect(
      workerEnv({ ...base, WORKER_CONCURRENCY: "50" }).WORKER_CONCURRENCY,
    ).toBe(50);
    expect(() => workerEnv({ ...base, WORKER_CONCURRENCY: "51" })).toThrow();
  });
});
