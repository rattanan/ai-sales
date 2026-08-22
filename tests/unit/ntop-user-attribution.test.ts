import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("NTOP per-user attribution", () => {
  const schema = read("prisma/schema.prisma");
  const credentialService = read("server/services/ntop-credential-service.ts");
  const actionService = read("server/services/ntop-action-service.ts");
  const orchestrator = read("server/services/ntop-chat-orchestrator.ts");
  const client = read("server/integrations/ntop/client.ts");
  const chat = read("server/services/chat-service.ts");

  it("stores the personal key as an authenticated encrypted envelope", () => {
    expect(schema).toContain("ntopApiKeyCiphertext");
    expect(schema).toContain("ntopApiKeyAuthTag");
    expect(schema).toContain("ntopApiKeyPrefix");
    expect(credentialService).toContain("AesGcmCredentialEncryptionService");
    expect(schema).not.toContain("ntopApiKeyPlaintext");
  });

  it("binds reads and writes to the authenticated InsightKM user", () => {
    expect(chat).toContain("context.userId,\n    input.message");
    expect(orchestrator).toContain("configuredNtopConnectionForUser(userId");
    expect(actionService).toContain(
      "configuredNtopClientForUser(context.userId)",
    );
    expect(actionService).not.toContain(
      "configuredNtopClientForUser(context.userId, { allowLegacyKey: true })",
    );
  });

  it("does not suggest an NTOP write without a personal user key", () => {
    expect(client).toContain("credentialSource: personalApiKey");
    expect(client).toContain('("USER" as const)');
    const lookup = orchestrator.indexOf('intent.intent === "LOOKUP"');
    const personalKeyGate = orchestrator.indexOf(
      'connection.credentialSource !== "USER"',
    );
    const firstAction = orchestrator.indexOf("action: {");
    expect(lookup).toBeGreaterThan(-1);
    expect(personalKeyGate).toBeGreaterThan(lookup);
    expect(firstAction).toBeGreaterThan(personalKeyGate);
  });

  it("keeps a pending action retryable when a personal key is missing", () => {
    const credentialCheck = actionService.indexOf(
      "configuredNtopClientForUser(context.userId)",
    );
    const claim = actionService.indexOf("updateMany({", credentialCheck);
    expect(credentialCheck).toBeGreaterThan(-1);
    expect(claim).toBeGreaterThan(credentialCheck);
  });
});
