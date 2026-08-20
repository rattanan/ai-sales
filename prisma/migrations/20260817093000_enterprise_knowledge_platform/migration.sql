-- Additive enterprise workflow upgrade. Existing Phase 1-8 records and
-- compatibility relations remain authoritative during the transition.

CREATE TYPE "SourceScope" AS ENUM ('GLOBAL', 'SELECTED_BOTS');
CREATE TYPE "EnterpriseSourceStatus" AS ENUM ('DRAFT', 'TESTING', 'PROCESSING', 'READY', 'FAILED', 'NEEDS_REINDEX', 'DISABLED');
CREATE TYPE "AiEndpointKind" AS ENUM ('CHAT', 'EMBEDDING');
CREATE TYPE "AiEndpointProviderType" AS ENUM ('OPENAI_COMPATIBLE', 'OLLAMA');
CREATE TYPE "ChatScope" AS ENUM ('SMART', 'ALL_ACCESSIBLE', 'SPECIFIC_BOT', 'SPECIFIC_SOURCES', 'DOCUMENTS', 'DATABASES', 'API_TOOLS', 'CONVERSATION_HISTORY', 'BUSINESS_INSIGHT');
CREATE TYPE "ChatMode" AS ENUM ('AUTO', 'ASK', 'SEARCH', 'ANALYZE', 'SUMMARIZE', 'GENERATE_REPORT', 'QUERY_LIVE_DATA');
CREATE TYPE "ToolTraceStatus" AS ENUM ('SELECTED', 'EXECUTING', 'COMPLETED', 'FAILED');

ALTER TYPE "KnowledgeSourceType" ADD VALUE 'COPIED_TEXT';

ALTER TABLE "Bot"
  ADD COLUMN "fallbackMessage" TEXT,
  ADD COLUMN "apiToolsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "databaseToolsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "primaryColor" TEXT NOT NULL DEFAULT '#4f46e5',
  ADD COLUMN "headerColor" TEXT NOT NULL DEFAULT '#111827',
  ADD COLUMN "chatBubbleColor" TEXT NOT NULL DEFAULT '#eef2ff',
  ADD COLUMN "fontFamily" TEXT NOT NULL DEFAULT 'system',
  ADD COLUMN "colorMode" TEXT NOT NULL DEFAULT 'LIGHT',
  ADD COLUMN "launcherIcon" TEXT,
  ADD COLUMN "windowPosition" TEXT NOT NULL DEFAULT 'RIGHT',
  ADD COLUMN "placeholder" TEXT NOT NULL DEFAULT 'Ask a question…',
  ADD COLUMN "brandingEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "status" "EnterpriseSourceStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "scope" "SourceScope" NOT NULL DEFAULT 'SELECTED_BOTS',
  ADD COLUMN "category" TEXT,
  ADD COLUMN "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "createdById" TEXT;

UPDATE "KnowledgeSource" s
SET "status" = CASE
  WHEN s.active = false THEN 'DISABLED'::"EnterpriseSourceStatus"
  WHEN s."lastRefreshStatus" = 'FAILED' THEN 'FAILED'::"EnterpriseSourceStatus"
  WHEN s."lastRefreshStatus" IN ('QUEUED', 'PROCESSING') THEN 'PROCESSING'::"EnterpriseSourceStatus"
  WHEN s."lastRefreshStatus" IN ('COMPLETED', 'PARTIAL') THEN 'READY'::"EnterpriseSourceStatus"
  WHEN EXISTS (
    SELECT 1 FROM "Document" d
    JOIN "DocumentVersion" v ON v.id = d."currentVersionId"
    WHERE d."sourceId" = s.id AND d.active = true AND v.status = 'INDEXED'
  ) THEN 'READY'::"EnterpriseSourceStatus"
  ELSE 'DRAFT'::"EnterpriseSourceStatus"
END;

ALTER TABLE "DataSource"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "sourceStatus" "EnterpriseSourceStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "sourceScope" "SourceScope" NOT NULL DEFAULT 'SELECTED_BOTS';

UPDATE "DataSource"
SET "sourceStatus" = CASE
  WHEN status = 'DISABLED' THEN 'DISABLED'::"EnterpriseSourceStatus"
  WHEN status = 'FAILED' THEN 'FAILED'::"EnterpriseSourceStatus"
  WHEN status = 'TESTING' THEN 'TESTING'::"EnterpriseSourceStatus"
  WHEN status = 'CONNECTED' THEN 'READY'::"EnterpriseSourceStatus"
  ELSE 'DRAFT'::"EnterpriseSourceStatus"
END;

ALTER TABLE "LegacyApi"
  ADD COLUMN "sourceStatus" "EnterpriseSourceStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "sourceScope" "SourceScope" NOT NULL DEFAULT 'SELECTED_BOTS';

UPDATE "LegacyApi"
SET "sourceStatus" = CASE
  WHEN enabled = false THEN 'DISABLED'::"EnterpriseSourceStatus"
  WHEN "lastTestStatus" = 'FAILED' THEN 'FAILED'::"EnterpriseSourceStatus"
  WHEN "lastTestStatus" = 'COMPLETED' THEN 'READY'::"EnterpriseSourceStatus"
  ELSE 'DRAFT'::"EnterpriseSourceStatus"
END;

ALTER TABLE "BotDataSource"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

ALTER TABLE "BotLegacyApi"
  ADD COLUMN "enabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 100;

CREATE TABLE "BotKnowledgeSource" (
  "botId" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BotKnowledgeSource_pkey" PRIMARY KEY ("botId", "sourceId")
);

INSERT INTO "BotKnowledgeSource" ("botId", "sourceId")
SELECT br."botId", s.id
FROM "BotKnowledgeRack" br
JOIN "KnowledgeSource" s ON s."rackId" = br."rackId"
ON CONFLICT DO NOTHING;

CREATE TABLE "CopiedTextSourceConfig" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CopiedTextSourceConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CopiedTextSourceConfig_sourceId_key" ON "CopiedTextSourceConfig"("sourceId");
CREATE INDEX "KnowledgeSource_rackId_scope_status_idx" ON "KnowledgeSource"("rackId", "scope", "status");
CREATE INDEX "KnowledgeSource_createdById_idx" ON "KnowledgeSource"("createdById");
CREATE INDEX "BotKnowledgeSource_sourceId_enabled_priority_idx" ON "BotKnowledgeSource"("sourceId", "enabled", "priority");
CREATE INDEX "DataSource_workspaceId_sourceScope_sourceStatus_idx" ON "DataSource"("workspaceId", "sourceScope", "sourceStatus");
CREATE INDEX "LegacyApi_workspaceId_sourceScope_sourceStatus_idx" ON "LegacyApi"("workspaceId", "sourceScope", "sourceStatus");

ALTER TABLE "Conversation" ADD COLUMN "isUniversal" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChatMessage"
  ADD COLUMN "scope" "ChatScope",
  ADD COLUMN "mode" "ChatMode",
  ADD COLUMN "scopeConfig" JSONB;

CREATE TABLE "MessageRetrievalTrace" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "chunkId" TEXT,
  "rank" INTEGER NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MessageRetrievalTrace_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ToolExecutionTrace" (
  "id" TEXT NOT NULL,
  "messageId" TEXT NOT NULL,
  "toolType" TEXT NOT NULL,
  "toolId" TEXT,
  "status" "ToolTraceStatus" NOT NULL,
  "maskedInput" JSONB,
  "maskedOutput" JSONB,
  "durationMs" INTEGER,
  "errorCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolExecutionTrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MessageRetrievalTrace_messageId_rank_idx" ON "MessageRetrievalTrace"("messageId", "rank");
CREATE INDEX "MessageRetrievalTrace_sourceType_sourceId_idx" ON "MessageRetrievalTrace"("sourceType", "sourceId");
CREATE INDEX "ToolExecutionTrace_messageId_createdAt_idx" ON "ToolExecutionTrace"("messageId", "createdAt");
CREATE INDEX "ToolExecutionTrace_toolType_toolId_status_idx" ON "ToolExecutionTrace"("toolType", "toolId", "status");

CREATE TABLE "AiEndpointConfig" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "AiEndpointKind" NOT NULL,
  "providerType" "AiEndpointProviderType" NOT NULL DEFAULT 'OPENAI_COMPATIBLE',
  "baseUrl" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "temperature" DOUBLE PRECISION,
  "maxTokens" INTEGER,
  "batchSize" INTEGER,
  "vectorDimension" INTEGER,
  "timeoutMs" INTEGER NOT NULL DEFAULT 30000,
  "maxRetries" INTEGER NOT NULL DEFAULT 2,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "lastHealthStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
  "lastHealthMessage" TEXT,
  "lastLatencyMs" INTEGER,
  "lastDetectedDimension" INTEGER,
  "lastTestedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEndpointConfig_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AiEndpointCredential" (
  "id" TEXT NOT NULL,
  "endpointId" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" TEXT NOT NULL,
  "authTag" TEXT NOT NULL,
  "keyVersion" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEndpointCredential_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "BotProviderConfig" ADD COLUMN "chatEndpointId" TEXT;

CREATE UNIQUE INDEX "AiEndpointConfig_organizationId_kind_name_key" ON "AiEndpointConfig"("organizationId", "kind", "name");
CREATE INDEX "AiEndpointConfig_organizationId_kind_active_idx" ON "AiEndpointConfig"("organizationId", "kind", "active");
CREATE UNIQUE INDEX "AiEndpointCredential_endpointId_key" ON "AiEndpointCredential"("endpointId");
CREATE INDEX "BotProviderConfig_chatEndpointId_idx" ON "BotProviderConfig"("chatEndpointId");

CREATE TABLE "KnowledgeGap" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "question" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "priority" TEXT NOT NULL DEFAULT 'MEDIUM',
  "assigneeId" TEXT,
  "evidenceMessageIds" TEXT[] NOT NULL,
  "resolutionSourceType" TEXT,
  "resolutionSourceId" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KnowledgeGap_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KnowledgeGap_workspaceId_status_priority_idx" ON "KnowledgeGap"("workspaceId", "status", "priority");
CREATE INDEX "KnowledgeGap_assigneeId_status_idx" ON "KnowledgeGap"("assigneeId", "status");

ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BotKnowledgeSource" ADD CONSTRAINT "BotKnowledgeSource_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotKnowledgeSource" ADD CONSTRAINT "BotKnowledgeSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CopiedTextSourceConfig" ADD CONSTRAINT "CopiedTextSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageRetrievalTrace" ADD CONSTRAINT "MessageRetrievalTrace_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ToolExecutionTrace" ADD CONSTRAINT "ToolExecutionTrace_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiEndpointConfig" ADD CONSTRAINT "AiEndpointConfig_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiEndpointConfig" ADD CONSTRAINT "AiEndpointConfig_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AiEndpointCredential" ADD CONSTRAINT "AiEndpointCredential_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "AiEndpointConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BotProviderConfig" ADD CONSTRAINT "BotProviderConfig_chatEndpointId_fkey" FOREIGN KEY ("chatEndpointId") REFERENCES "AiEndpointConfig"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeGap" ADD CONSTRAINT "KnowledgeGap_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
