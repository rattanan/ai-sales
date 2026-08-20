-- Phase 1: organization scope, provider configuration, privacy and retention.
ALTER TABLE "OrganizationMember" ADD COLUMN "organizationUnitId" TEXT;

CREATE TABLE "OrganizationUnit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OrganizationProject" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OrganizationProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserProject" (
    "id" TEXT NOT NULL,
    "organizationMemberId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserProject_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmProvider" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerType" TEXT NOT NULL DEFAULT 'openai-compatible',
    "baseUrl" TEXT NOT NULL,
    "chatModel" TEXT NOT NULL,
    "embeddingModel" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
    "maxTokens" INTEGER NOT NULL DEFAULT 4096,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "supportsJsonSchema" BOOLEAN NOT NULL DEFAULT true,
    "lastHealthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastHealthMessage" TEXT,
    "lastChatLatencyMs" INTEGER,
    "lastEmbeddingLatencyMs" INTEGER,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LlmProvider_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LlmProviderCredential" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LlmProviderCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PiiMaskingPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "maskEmail" BOOLEAN NOT NULL DEFAULT true,
    "maskPhone" BOOLEAN NOT NULL DEFAULT true,
    "maskNationalId" BOOLEAN NOT NULL DEFAULT true,
    "maskFinancialAccount" BOOLEAN NOT NULL DEFAULT true,
    "allowSensitiveAiAccess" BOOLEAN NOT NULL DEFAULT false,
    "customPatterns" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PiiMaskingPolicy_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SystemRetentionPolicy" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "auditLogDays" INTEGER NOT NULL DEFAULT 365,
    "loginHistoryDays" INTEGER NOT NULL DEFAULT 180,
    "chatHistoryDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SystemRetentionPolicy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrganizationUnit_organizationId_active_idx" ON "OrganizationUnit"("organizationId", "active");
CREATE UNIQUE INDEX "OrganizationUnit_organizationId_code_key" ON "OrganizationUnit"("organizationId", "code");
CREATE UNIQUE INDEX "OrganizationUnit_organizationId_name_key" ON "OrganizationUnit"("organizationId", "name");
CREATE INDEX "OrganizationProject_organizationId_active_idx" ON "OrganizationProject"("organizationId", "active");
CREATE UNIQUE INDEX "OrganizationProject_organizationId_code_key" ON "OrganizationProject"("organizationId", "code");
CREATE UNIQUE INDEX "OrganizationProject_organizationId_name_key" ON "OrganizationProject"("organizationId", "name");
CREATE INDEX "UserProject_projectId_idx" ON "UserProject"("projectId");
CREATE UNIQUE INDEX "UserProject_organizationMemberId_projectId_key" ON "UserProject"("organizationMemberId", "projectId");
CREATE INDEX "LlmProvider_organizationId_active_idx" ON "LlmProvider"("organizationId", "active");
CREATE UNIQUE INDEX "LlmProvider_organizationId_name_key" ON "LlmProvider"("organizationId", "name");
CREATE UNIQUE INDEX "LlmProviderCredential_providerId_key" ON "LlmProviderCredential"("providerId");
CREATE UNIQUE INDEX "PiiMaskingPolicy_organizationId_key" ON "PiiMaskingPolicy"("organizationId");
CREATE UNIQUE INDEX "SystemRetentionPolicy_organizationId_key" ON "SystemRetentionPolicy"("organizationId");
CREATE INDEX "OrganizationMember_organizationId_organizationUnitId_idx" ON "OrganizationMember"("organizationId", "organizationUnitId");

ALTER TABLE "OrganizationMember" ADD CONSTRAINT "OrganizationMember_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrganizationUnit" ADD CONSTRAINT "OrganizationUnit_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationProject" ADD CONSTRAINT "OrganizationProject_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProject" ADD CONSTRAINT "UserProject_organizationMemberId_fkey" FOREIGN KEY ("organizationMemberId") REFERENCES "OrganizationMember"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProject" ADD CONSTRAINT "UserProject_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OrganizationProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmProvider" ADD CONSTRAINT "LlmProvider_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LlmProviderCredential" ADD CONSTRAINT "LlmProviderCredential_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PiiMaskingPolicy" ADD CONSTRAINT "PiiMaskingPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SystemRetentionPolicy" ADD CONSTRAINT "SystemRetentionPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
