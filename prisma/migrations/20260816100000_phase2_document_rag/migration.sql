-- CreateEnum
CREATE TYPE "BotAccessLevel" AS ENUM ('USE', 'MANAGE');

-- CreateEnum
CREATE TYPE "KnowledgeAccessLevel" AS ENUM ('READ', 'UPLOAD', 'MANAGE');

-- CreateEnum
CREATE TYPE "DocumentVersionStatus" AS ENUM ('UPLOADED', 'QUEUED', 'PROCESSING', 'INDEXED', 'FAILED');

-- CreateEnum
CREATE TYPE "IndexJobStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ChatMessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "avatarUrl" TEXT,
    "systemPrompt" TEXT NOT NULL,
    "welcomeMessage" TEXT NOT NULL,
    "suggestedQuestions" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotVersion" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "configuration" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "level" "BotAccessLevel" NOT NULL DEFAULT 'USE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotProviderConfig" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "providerId" TEXT,
    "model" TEXT,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.1,
    "maxTokens" INTEGER NOT NULL DEFAULT 2048,
    "contextSize" INTEGER NOT NULL DEFAULT 12000,
    "citationEnabled" BOOLEAN NOT NULL DEFAULT true,
    "memoryMode" TEXT NOT NULL DEFAULT 'CONVERSATION',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotProviderConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotKnowledgeRack" (
    "botId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotKnowledgeRack_pkey" PRIMARY KEY ("botId","rackId")
);

-- CreateTable
CREATE TABLE "KnowledgeRack" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeRack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeRackAccess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "userId" TEXT,
    "roleId" TEXT,
    "level" "KnowledgeAccessLevel" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KnowledgeRackAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeSource" (
    "id" TEXT NOT NULL,
    "rackId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'FILE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "currentVersionId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT 'insightkm-parser-v1',
    "status" "DocumentVersionStatus" NOT NULL DEFAULT 'UPLOADED',
    "errorMessage" TEXT,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentChunk" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "tokenCount" INTEGER NOT NULL,
    "metadata" JSONB,
    "embedding" vector,
    "embeddingModel" TEXT,
    "embeddingDimension" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentIndexJob" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "status" "IndexJobStatus" NOT NULL DEFAULT 'QUEUED',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "embeddingModel" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL DEFAULT 'insightkm-parser-v1',
    "chunkingVersion" TEXT NOT NULL DEFAULT 'insightkm-chunker-v1',
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DocumentIndexJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "ChatMessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "latencyMs" INTEGER,
    "errorCode" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageCitation" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "chunkId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "quote" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageCitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessageFeedback" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessageFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Bot_organizationId_active_idx" ON "Bot"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Bot_organizationId_name_key" ON "Bot"("organizationId", "name");

-- CreateIndex
CREATE INDEX "BotVersion_botId_createdAt_idx" ON "BotVersion"("botId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BotVersion_botId_version_key" ON "BotVersion"("botId", "version");

-- CreateIndex
CREATE INDEX "BotAccess_organizationId_userId_idx" ON "BotAccess"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "BotAccess_organizationId_roleId_idx" ON "BotAccess"("organizationId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccess_botId_userId_key" ON "BotAccess"("botId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BotAccess_botId_roleId_key" ON "BotAccess"("botId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "BotProviderConfig_botId_key" ON "BotProviderConfig"("botId");

-- CreateIndex
CREATE INDEX "BotProviderConfig_providerId_idx" ON "BotProviderConfig"("providerId");

-- CreateIndex
CREATE INDEX "BotKnowledgeRack_rackId_idx" ON "BotKnowledgeRack"("rackId");

-- CreateIndex
CREATE INDEX "KnowledgeRack_organizationId_active_idx" ON "KnowledgeRack"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRack_organizationId_name_key" ON "KnowledgeRack"("organizationId", "name");

-- CreateIndex
CREATE INDEX "KnowledgeRackAccess_organizationId_userId_idx" ON "KnowledgeRackAccess"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "KnowledgeRackAccess_organizationId_roleId_idx" ON "KnowledgeRackAccess"("organizationId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRackAccess_rackId_userId_key" ON "KnowledgeRackAccess"("rackId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeRackAccess_rackId_roleId_key" ON "KnowledgeRackAccess"("rackId", "roleId");

-- CreateIndex
CREATE INDEX "KnowledgeSource_rackId_active_idx" ON "KnowledgeSource"("rackId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeSource_rackId_name_key" ON "KnowledgeSource"("rackId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Document_currentVersionId_key" ON "Document"("currentVersionId");

-- CreateIndex
CREATE INDEX "Document_organizationId_active_idx" ON "Document"("organizationId", "active");

-- CreateIndex
CREATE INDEX "Document_sourceId_active_idx" ON "Document"("sourceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Document_sourceId_checksum_key" ON "Document"("sourceId", "checksum");

-- CreateIndex
CREATE INDEX "DocumentVersion_status_createdAt_idx" ON "DocumentVersion"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_version_key" ON "DocumentVersion"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentVersion_documentId_checksum_key" ON "DocumentVersion"("documentId", "checksum");

-- CreateIndex
CREATE INDEX "DocumentChunk_documentVersionId_idx" ON "DocumentChunk"("documentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentVersionId_ordinal_key" ON "DocumentChunk"("documentVersionId", "ordinal");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentChunk_documentVersionId_contentHash_key" ON "DocumentChunk"("documentVersionId", "contentHash");

-- CreateIndex
CREATE INDEX "DocumentIndexJob_status_createdAt_idx" ON "DocumentIndexJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentIndexJob_documentVersionId_embeddingModel_parserVer_key" ON "DocumentIndexJob"("documentVersionId", "embeddingModel", "parserVersion", "chunkingVersion");

-- CreateIndex
CREATE INDEX "Conversation_organizationId_userId_lastMessageAt_idx" ON "Conversation"("organizationId", "userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_botId_userId_deletedAt_idx" ON "Conversation"("botId", "userId", "deletedAt");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageCitation_chunkId_idx" ON "MessageCitation"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageCitation_messageId_chunkId_key" ON "MessageCitation"("messageId", "chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageFeedback_messageId_key" ON "ChatMessageFeedback"("messageId");

-- CreateIndex
CREATE INDEX "ChatMessageFeedback_userId_createdAt_idx" ON "ChatMessageFeedback"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Bot" ADD CONSTRAINT "Bot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotVersion" ADD CONSTRAINT "BotVersion_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAccess" ADD CONSTRAINT "BotAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAccess" ADD CONSTRAINT "BotAccess_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAccess" ADD CONSTRAINT "BotAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotAccess" ADD CONSTRAINT "BotAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotProviderConfig" ADD CONSTRAINT "BotProviderConfig_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotProviderConfig" ADD CONSTRAINT "BotProviderConfig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "LlmProvider"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotKnowledgeRack" ADD CONSTRAINT "BotKnowledgeRack_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotKnowledgeRack" ADD CONSTRAINT "BotKnowledgeRack_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "KnowledgeRack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRack" ADD CONSTRAINT "KnowledgeRack_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRack" ADD CONSTRAINT "KnowledgeRack_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRackAccess" ADD CONSTRAINT "KnowledgeRackAccess_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRackAccess" ADD CONSTRAINT "KnowledgeRackAccess_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "KnowledgeRack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRackAccess" ADD CONSTRAINT "KnowledgeRackAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeRackAccess" ADD CONSTRAINT "KnowledgeRackAccess_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnowledgeSource" ADD CONSTRAINT "KnowledgeSource_rackId_fkey" FOREIGN KEY ("rackId") REFERENCES "KnowledgeRack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentVersion" ADD CONSTRAINT "DocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentChunk" ADD CONSTRAINT "DocumentChunk_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentIndexJob" ADD CONSTRAINT "DocumentIndexJob_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "DocumentVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "DocumentChunk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce unambiguous ACL principals and bounded feedback values at the database boundary.
ALTER TABLE "BotAccess" ADD CONSTRAINT "BotAccess_exactly_one_principal" CHECK (num_nonnulls("userId", "roleId") = 1);
ALTER TABLE "KnowledgeRackAccess" ADD CONSTRAINT "KnowledgeRackAccess_exactly_one_principal" CHECK (num_nonnulls("userId", "roleId") = 1);
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_rating_range" CHECK ("rating" IN (-1, 1));

-- Phase 2 uses exact tenant/ACL filtering before ranking. The expression index
-- accelerates the keyword side of hybrid retrieval for Thai and English text.
CREATE INDEX "DocumentChunk_content_fts_idx" ON "DocumentChunk" USING GIN (to_tsvector('simple', "content"));
