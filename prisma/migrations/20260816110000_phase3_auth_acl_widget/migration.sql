CREATE TYPE "AuthenticationMode" AS ENUM ('EMBEDDED', 'EXTERNAL_API', 'LOCAL');
CREATE TYPE "EmbeddedSignatureMode" AS ENUM ('HMAC_SHA256', 'JWT_HS256', 'BOTH');
CREATE TYPE "ExternalAuthMethod" AS ENUM ('GET', 'POST', 'PUT');
CREATE TYPE "ResourceType" AS ENUM ('BOT', 'KNOWLEDGE_RACK', 'KNOWLEDGE_SOURCE', 'DOCUMENT', 'DATA_SOURCE', 'DATABASE_SCHEMA', 'DATABASE_TABLE', 'LEGACY_API', 'CHAT', 'INSIGHT');
CREATE TYPE "ResourceAccessEffect" AS ENUM ('ALLOW', 'DENY');
CREATE TYPE "ResourceAccessLevel" AS ENUM ('VIEW', 'USE', 'EDIT', 'MANAGE');

ALTER TABLE "LoginHistory"
  ADD COLUMN "authMode" "AuthenticationMode" NOT NULL DEFAULT 'LOCAL',
  ADD COLUMN "externalSessionId" TEXT,
  ADD COLUMN "origin" TEXT;
ALTER TABLE "User" ADD COLUMN "isShadow" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "AuthenticationPolicy" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "localEnabled" BOOLEAN NOT NULL DEFAULT true,
  "externalApiEnabled" BOOLEAN NOT NULL DEFAULT false,
  "embeddedEnabled" BOOLEAN NOT NULL DEFAULT false,
  "modePriority" JSONB NOT NULL DEFAULT '["EMBEDDED","EXTERNAL_API","LOCAL"]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AuthenticationPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuthenticationPolicy_has_mode_check" CHECK ("localEnabled" OR "externalApiEnabled" OR "embeddedEnabled")
);

CREATE TABLE "EmbeddedAuthConfig" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "signatureMode" "EmbeddedSignatureMode" NOT NULL DEFAULT 'BOTH',
  "allowedOrigins" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "replayWindowSeconds" INTEGER NOT NULL DEFAULT 300,
  "sessionTtlSeconds" INTEGER NOT NULL DEFAULT 28800,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "lastRotatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EmbeddedAuthConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EmbeddedAuthConfig_windows_check" CHECK ("replayWindowSeconds" BETWEEN 30 AND 900 AND "sessionTtlSeconds" BETWEEN 300 AND 86400)
);

CREATE TABLE "ExternalAuthConfig" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "method" "ExternalAuthMethod" NOT NULL DEFAULT 'POST',
  "headers" JSONB,
  "requestMapping" JSONB NOT NULL,
  "responseMapping" JSONB NOT NULL,
  "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "lastHealthStatus" TEXT,
  "lastHealthMessage" TEXT,
  "lastHealthLatencyMs" INTEGER,
  "lastTestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalAuthConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalAuthConfig_timeout_check" CHECK ("timeoutMs" BETWEEN 500 AND 30000)
);

CREATE TABLE "ExternalAuthCredential" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "headerName" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalAuthCredential_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmbeddedAuthNonce" (
  "id" TEXT NOT NULL,
  "configId" TEXT NOT NULL,
  "nonceHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EmbeddedAuthNonce_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalIdentity" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "mode" "AuthenticationMode" NOT NULL,
  "externalUserId" TEXT NOT NULL,
  "externalUsername" TEXT,
  "lastExternalSessionId" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalSession" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "botId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "conversationId" TEXT,
  "authMode" "AuthenticationMode" NOT NULL,
  "externalSessionId" TEXT NOT NULL,
  "origin" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalSession_non_local_check" CHECK ("authMode" <> 'LOCAL')
);

CREATE TABLE "ResourceAcl" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "resourceType" "ResourceType" NOT NULL,
  "resourceId" TEXT NOT NULL,
  "userId" TEXT,
  "roleId" TEXT,
  "effect" "ResourceAccessEffect" NOT NULL DEFAULT 'ALLOW',
  "accessLevel" "ResourceAccessLevel" NOT NULL DEFAULT 'VIEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ResourceAcl_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ResourceAcl_exactly_one_principal_check" CHECK (("userId" IS NOT NULL)::int + ("roleId" IS NOT NULL)::int = 1)
);

CREATE UNIQUE INDEX "AuthenticationPolicy_organizationId_key" ON "AuthenticationPolicy"("organizationId");
CREATE UNIQUE INDEX "EmbeddedAuthConfig_policyId_key" ON "EmbeddedAuthConfig"("policyId");
CREATE UNIQUE INDEX "EmbeddedAuthConfig_keyId_key" ON "EmbeddedAuthConfig"("keyId");
CREATE UNIQUE INDEX "ExternalAuthConfig_policyId_key" ON "ExternalAuthConfig"("policyId");
CREATE UNIQUE INDEX "ExternalAuthCredential_configId_key" ON "ExternalAuthCredential"("configId");
CREATE INDEX "EmbeddedAuthNonce_expiresAt_idx" ON "EmbeddedAuthNonce"("expiresAt");
CREATE UNIQUE INDEX "EmbeddedAuthNonce_configId_nonceHash_key" ON "EmbeddedAuthNonce"("configId", "nonceHash");
CREATE INDEX "ExternalIdentity_userId_organizationId_idx" ON "ExternalIdentity"("userId", "organizationId");
CREATE UNIQUE INDEX "ExternalIdentity_organizationId_mode_externalUserId_key" ON "ExternalIdentity"("organizationId", "mode", "externalUserId");
CREATE UNIQUE INDEX "ExternalSession_tokenHash_key" ON "ExternalSession"("tokenHash");
CREATE UNIQUE INDEX "ExternalSession_organizationId_botId_externalSessionId_key" ON "ExternalSession"("organizationId", "botId", "externalSessionId");
CREATE INDEX "ExternalSession_organizationId_userId_botId_idx" ON "ExternalSession"("organizationId", "userId", "botId");
CREATE INDEX "ExternalSession_expiresAt_revokedAt_idx" ON "ExternalSession"("expiresAt", "revokedAt");
CREATE INDEX "ResourceAcl_organizationId_resourceType_resourceId_effect_idx" ON "ResourceAcl"("organizationId", "resourceType", "resourceId", "effect");
CREATE INDEX "ResourceAcl_userId_organizationId_idx" ON "ResourceAcl"("userId", "organizationId");
CREATE INDEX "ResourceAcl_roleId_organizationId_idx" ON "ResourceAcl"("roleId", "organizationId");
CREATE UNIQUE INDEX "ResourceAcl_organizationId_resourceType_resourceId_userId_key" ON "ResourceAcl"("organizationId", "resourceType", "resourceId", "userId");
CREATE UNIQUE INDEX "ResourceAcl_organizationId_resourceType_resourceId_roleId_key" ON "ResourceAcl"("organizationId", "resourceType", "resourceId", "roleId");

ALTER TABLE "AuthenticationPolicy" ADD CONSTRAINT "AuthenticationPolicy_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmbeddedAuthConfig" ADD CONSTRAINT "EmbeddedAuthConfig_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AuthenticationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalAuthConfig" ADD CONSTRAINT "ExternalAuthConfig_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "AuthenticationPolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalAuthCredential" ADD CONSTRAINT "ExternalAuthCredential_configId_fkey" FOREIGN KEY ("configId") REFERENCES "ExternalAuthConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmbeddedAuthNonce" ADD CONSTRAINT "EmbeddedAuthNonce_configId_fkey" FOREIGN KEY ("configId") REFERENCES "EmbeddedAuthConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalIdentity" ADD CONSTRAINT "ExternalIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSession" ADD CONSTRAINT "ExternalSession_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSession" ADD CONSTRAINT "ExternalSession_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSession" ADD CONSTRAINT "ExternalSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalSession" ADD CONSTRAINT "ExternalSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ResourceAcl" ADD CONSTRAINT "ResourceAcl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceAcl" ADD CONSTRAINT "ResourceAcl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ResourceAcl" ADD CONSTRAINT "ResourceAcl_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;
