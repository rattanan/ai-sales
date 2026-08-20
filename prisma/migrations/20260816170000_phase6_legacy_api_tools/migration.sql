-- CreateEnum
CREATE TYPE "LegacyApiAuthType" AS ENUM ('NONE', 'API_KEY', 'BEARER', 'BASIC', 'CUSTOM_HEADER');

-- CreateEnum
CREATE TYPE "LegacyApiHttpMethod" AS ENUM ('GET', 'POST');

-- CreateEnum
CREATE TYPE "LegacyApiInvocationStatus" AS ENUM ('CLARIFICATION_REQUIRED', 'EXECUTING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "MessageCitation" ADD COLUMN "legacyApiInvocationId" TEXT;
ALTER TABLE "MessageCitation" DROP CONSTRAINT "MessageCitation_exactly_one_source_check";

-- CreateTable
CREATE TABLE "BotLegacyApi" (
    "botId" TEXT NOT NULL,
    "legacyApiId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BotLegacyApi_pkey" PRIMARY KEY ("botId", "legacyApiId")
);

-- CreateTable
CREATE TABLE "LegacyApi" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "endpointPath" TEXT NOT NULL,
    "method" "LegacyApiHttpMethod" NOT NULL DEFAULT 'GET',
    "readOnlyConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedDomains" TEXT[],
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "maxResponseBytes" INTEGER NOT NULL DEFAULT 1048576,
    "maxRedirects" INTEGER NOT NULL DEFAULT 2,
    "requestHeaders" JSONB,
    "parameterDefinitions" JSONB NOT NULL,
    "bodyTemplate" JSONB,
    "responseSchema" JSONB NOT NULL,
    "responseMapping" JSONB,
    "authType" "LegacyApiAuthType" NOT NULL DEFAULT 'NONE',
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "lastTestLatencyMs" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegacyApi_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LegacyApi_read_only_check" CHECK ("method" = 'GET' OR "readOnlyConfirmed" = true),
    CONSTRAINT "LegacyApi_limits_check" CHECK ("timeoutMs" BETWEEN 1000 AND 60000 AND "maxResponseBytes" BETWEEN 1024 AND 10485760 AND "maxRedirects" BETWEEN 0 AND 5)
);

-- CreateTable
CREATE TABLE "LegacyApiCredential" (
    "id" TEXT NOT NULL,
    "legacyApiId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegacyApiCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LegacyApiInvocation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "legacyApiId" TEXT NOT NULL,
    "botId" TEXT,
    "requestedById" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "LegacyApiInvocationStatus" NOT NULL,
    "clarification" TEXT,
    "parameterNames" TEXT[],
    "requestFingerprint" TEXT,
    "resultPreview" JSONB,
    "summary" TEXT,
    "citationMetadata" JSONB,
    "httpStatus" INTEGER,
    "durationMs" INTEGER,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LegacyApiInvocation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotLegacyApi_legacyApiId_idx" ON "BotLegacyApi"("legacyApiId");
CREATE INDEX "LegacyApi_organizationId_enabled_idx" ON "LegacyApi"("organizationId", "enabled");
CREATE UNIQUE INDEX "LegacyApi_workspaceId_name_key" ON "LegacyApi"("workspaceId", "name");
CREATE UNIQUE INDEX "LegacyApiCredential_legacyApiId_key" ON "LegacyApiCredential"("legacyApiId");
CREATE INDEX "LegacyApiInvocation_workspaceId_requestedById_createdAt_idx" ON "LegacyApiInvocation"("workspaceId", "requestedById", "createdAt");
CREATE INDEX "LegacyApiInvocation_legacyApiId_status_createdAt_idx" ON "LegacyApiInvocation"("legacyApiId", "status", "createdAt");
CREATE INDEX "LegacyApiInvocation_botId_createdAt_idx" ON "LegacyApiInvocation"("botId", "createdAt");
CREATE INDEX "MessageCitation_legacyApiInvocationId_idx" ON "MessageCitation"("legacyApiInvocationId");
CREATE UNIQUE INDEX "MessageCitation_messageId_legacyApiInvocationId_key" ON "MessageCitation"("messageId", "legacyApiInvocationId");

-- A citation must reference one governed source, never a mixed source record.
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_exactly_one_source_check"
CHECK (num_nonnulls("chunkId", "databaseQueryId", "legacyApiInvocationId") = 1);

-- AddForeignKey
ALTER TABLE "BotLegacyApi" ADD CONSTRAINT "BotLegacyApi_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotLegacyApi" ADD CONSTRAINT "BotLegacyApi_legacyApiId_fkey" FOREIGN KEY ("legacyApiId") REFERENCES "LegacyApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_legacyApiInvocationId_fkey" FOREIGN KEY ("legacyApiInvocationId") REFERENCES "LegacyApiInvocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApi" ADD CONSTRAINT "LegacyApi_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApi" ADD CONSTRAINT "LegacyApi_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApi" ADD CONSTRAINT "LegacyApi_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LegacyApiCredential" ADD CONSTRAINT "LegacyApiCredential_legacyApiId_fkey" FOREIGN KEY ("legacyApiId") REFERENCES "LegacyApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApiInvocation" ADD CONSTRAINT "LegacyApiInvocation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApiInvocation" ADD CONSTRAINT "LegacyApiInvocation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApiInvocation" ADD CONSTRAINT "LegacyApiInvocation_legacyApiId_fkey" FOREIGN KEY ("legacyApiId") REFERENCES "LegacyApi"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LegacyApiInvocation" ADD CONSTRAINT "LegacyApiInvocation_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LegacyApiInvocation" ADD CONSTRAINT "LegacyApiInvocation_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
