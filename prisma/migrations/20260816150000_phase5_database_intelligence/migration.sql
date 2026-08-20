-- CreateEnum
CREATE TYPE "DatabaseQueryStatus" AS ENUM ('CLARIFICATION_REQUIRED', 'READY_FOR_REVIEW', 'EXECUTING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DatabaseQueryIntent" AS ENUM ('DATABASE', 'DOCUMENT', 'CLARIFICATION');

-- CreateEnum
CREATE TYPE "MetadataRefreshStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- AlterTable
ALTER TABLE "DataSource" ADD COLUMN     "lastMetadataDiff" JSONB,
ADD COLUMN     "metadataFingerprint" TEXT,
ADD COLUMN     "metadataVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sampleDataEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "DataSourceColumn" ADD COLUMN     "databaseComment" TEXT,
ADD COLUMN     "lastSeenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "metadataFingerprint" TEXT,
ADD COLUMN     "semanticDescription" TEXT,
ADD COLUMN     "semanticFingerprint" TEXT,
ADD COLUMN     "semanticModel" TEXT,
ADD COLUMN     "semanticVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DataSourceSchema" ADD COLUMN     "databaseComment" TEXT,
ADD COLUMN     "lastSeenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "metadataFingerprint" TEXT;

-- AlterTable
ALTER TABLE "DataSourceTable" ADD COLUMN     "databaseComment" TEXT,
ADD COLUMN     "lastSeenVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "metadataFingerprint" TEXT,
ADD COLUMN     "sampleDataEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "semanticDescription" TEXT,
ADD COLUMN     "semanticEmbedding" vector,
ADD COLUMN     "semanticEmbeddingDimension" INTEGER,
ADD COLUMN     "semanticEmbeddingModel" TEXT,
ADD COLUMN     "semanticFingerprint" TEXT,
ADD COLUMN     "semanticModel" TEXT,
ADD COLUMN     "semanticVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MessageCitation" ADD COLUMN     "databaseQueryId" TEXT,
ALTER COLUMN "chunkId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "BotDataSource" (
    "botId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotDataSource_pkey" PRIMARY KEY ("botId","dataSourceId")
);

-- CreateTable
CREATE TABLE "MetadataRefreshRun" (
    "id" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "MetadataRefreshStatus" NOT NULL DEFAULT 'PROCESSING',
    "addedSchemas" INTEGER NOT NULL DEFAULT 0,
    "changedSchemas" INTEGER NOT NULL DEFAULT 0,
    "removedSchemas" INTEGER NOT NULL DEFAULT 0,
    "addedTables" INTEGER NOT NULL DEFAULT 0,
    "changedTables" INTEGER NOT NULL DEFAULT 0,
    "removedTables" INTEGER NOT NULL DEFAULT 0,
    "addedColumns" INTEGER NOT NULL DEFAULT 0,
    "changedColumns" INTEGER NOT NULL DEFAULT 0,
    "removedColumns" INTEGER NOT NULL DEFAULT 0,
    "errorDetails" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetadataRefreshRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DatabaseQuery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "botId" TEXT,
    "requestedById" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "intent" "DatabaseQueryIntent" NOT NULL DEFAULT 'DATABASE',
    "status" "DatabaseQueryStatus" NOT NULL,
    "clarification" TEXT,
    "proposedSql" TEXT,
    "validatedSql" TEXT,
    "sqlHash" TEXT,
    "metadataVersion" INTEGER NOT NULL,
    "selectedMetadata" JSONB NOT NULL,
    "referencedTables" JSONB,
    "resultSchema" JSONB,
    "previewRows" JSONB,
    "rowCount" INTEGER,
    "durationMs" INTEGER,
    "summary" TEXT,
    "citationMetadata" JSONB,
    "provider" TEXT,
    "model" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DatabaseQuery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BotDataSource_dataSourceId_idx" ON "BotDataSource"("dataSourceId");

-- CreateIndex
CREATE INDEX "MetadataRefreshRun_dataSourceId_createdAt_idx" ON "MetadataRefreshRun"("dataSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "MetadataRefreshRun_status_createdAt_idx" ON "MetadataRefreshRun"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MetadataRefreshRun_dataSourceId_version_key" ON "MetadataRefreshRun"("dataSourceId", "version");

-- CreateIndex
CREATE INDEX "DatabaseQuery_workspaceId_requestedById_createdAt_idx" ON "DatabaseQuery"("workspaceId", "requestedById", "createdAt");

-- CreateIndex
CREATE INDEX "DatabaseQuery_dataSourceId_status_createdAt_idx" ON "DatabaseQuery"("dataSourceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "DatabaseQuery_botId_createdAt_idx" ON "DatabaseQuery"("botId", "createdAt");

-- CreateIndex
CREATE INDEX "DatabaseQuery_sqlHash_idx" ON "DatabaseQuery"("sqlHash");

-- CreateIndex
CREATE INDEX "MessageCitation_databaseQueryId_idx" ON "MessageCitation"("databaseQueryId");

-- CreateIndex
CREATE UNIQUE INDEX "MessageCitation_messageId_databaseQueryId_key" ON "MessageCitation"("messageId", "databaseQueryId");

-- AddForeignKey
ALTER TABLE "BotDataSource" ADD CONSTRAINT "BotDataSource_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotDataSource" ADD CONSTRAINT "BotDataSource_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_databaseQueryId_fkey" FOREIGN KEY ("databaseQueryId") REFERENCES "DatabaseQuery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetadataRefreshRun" ADD CONSTRAINT "MetadataRefreshRun_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseQuery" ADD CONSTRAINT "DatabaseQuery_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A citation must point to exactly one governed source.
ALTER TABLE "MessageCitation" ADD CONSTRAINT "MessageCitation_exactly_one_source_check"
CHECK (num_nonnulls("chunkId", "databaseQueryId") = 1);

