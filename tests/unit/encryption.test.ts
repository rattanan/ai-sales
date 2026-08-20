import { describe, expect, it } from "vitest";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
} from "@/server/services/encryption";

describe("credential encryption", () => {
  const service = new AesGcmCredentialEncryptionService(Buffer.alloc(32, 7));
  it("round trips without storing plaintext", () => {
    const encrypted = service.encrypt("sensitive-password");
    expect(encrypted.ciphertext).not.toContain("sensitive-password");
    expect(service.decrypt(encrypted)).toBe("sensitive-password");
  });
  it("detects ciphertext tampering", () => {
    const encrypted = service.encrypt("sensitive-password");
    expect(() =>
      service.decrypt({
        ...encrypted,
        ciphertext: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow();
  });
  it("rejects invalid key lengths", () => {
    expect(
      () => new AesGcmCredentialEncryptionService(Buffer.alloc(16)),
    ).toThrow(/32 bytes/);
  });
  it("decrypts the previous version during a zero-downtime key rotation", () => {
    const previous = new AesGcmCredentialEncryptionService(
      Buffer.alloc(32, 3),
      "key-v1",
    );
    const envelope = previous.encrypt("rotate-me");
    const current = new AesGcmCredentialEncryptionService(
      Buffer.alloc(32, 4),
      "key-v2",
      parseEncryptionKeyRing(
        `key-v1:${Buffer.alloc(32, 3).toString("base64")}`,
      ),
    );
    expect(current.decrypt(envelope)).toBe("rotate-me");
    expect(current.encrypt("new").keyVersion).toBe("key-v2");
  });
});
