import { db } from "@/server/db";
import { env } from "@/schemas/env";
import { ntopApiKeySchema } from "@/schemas/ntop-credential";
import {
  AesGcmCredentialEncryptionService,
  parseEncryptionKeyRing,
  type EncryptedEnvelope,
} from "@/server/services/encryption";

function encryptionService() {
  const configuration = env();
  return new AesGcmCredentialEncryptionService(
    Buffer.from(configuration.CREDENTIAL_ENCRYPTION_KEY, "base64"),
    configuration.CREDENTIAL_KEY_VERSION,
    parseEncryptionKeyRing(configuration.CREDENTIAL_ENCRYPTION_PREVIOUS_KEYS),
  );
}

export function ntopApiKeyPrefix(apiKey: string) {
  return ntopApiKeySchema.parse(apiKey).split("_")[1]!;
}

export function encryptedNtopApiKey(apiKey: string) {
  const normalized = ntopApiKeySchema.parse(apiKey);
  const envelope = encryptionService().encrypt(normalized);
  return {
    ntopApiKeyCiphertext: envelope.ciphertext,
    ntopApiKeyIv: envelope.iv,
    ntopApiKeyAuthTag: envelope.authTag,
    ntopApiKeyKeyVersion: envelope.keyVersion,
    ntopApiKeyPrefix: ntopApiKeyPrefix(normalized),
    ntopApiKeyUpdatedAt: new Date(),
  };
}

export async function userNtopApiKey(userId: string) {
  const credential = await db.user.findUnique({
    where: { id: userId },
    select: {
      ntopApiKeyCiphertext: true,
      ntopApiKeyIv: true,
      ntopApiKeyAuthTag: true,
      ntopApiKeyKeyVersion: true,
    },
  });
  if (
    !credential?.ntopApiKeyCiphertext ||
    !credential.ntopApiKeyIv ||
    !credential.ntopApiKeyAuthTag ||
    !credential.ntopApiKeyKeyVersion
  )
    return null;
  const envelope: EncryptedEnvelope = {
    ciphertext: credential.ntopApiKeyCiphertext,
    iv: credential.ntopApiKeyIv,
    authTag: credential.ntopApiKeyAuthTag,
    keyVersion: credential.ntopApiKeyKeyVersion,
  };
  return encryptionService().decrypt(envelope);
}
