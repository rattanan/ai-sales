ALTER TABLE "User"
  ADD COLUMN "ntopApiKeyCiphertext" TEXT,
  ADD COLUMN "ntopApiKeyIv" TEXT,
  ADD COLUMN "ntopApiKeyAuthTag" TEXT,
  ADD COLUMN "ntopApiKeyKeyVersion" TEXT,
  ADD COLUMN "ntopApiKeyPrefix" TEXT,
  ADD COLUMN "ntopApiKeyUpdatedAt" TIMESTAMP(3);
