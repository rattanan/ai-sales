CREATE TYPE "KnowledgeSourceType" AS ENUM ('FILE', 'SHARED_FOLDER', 'WEB');
CREATE TYPE "SourceRefreshStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED');
CREATE TYPE "SourceRefreshTrigger" AS ENUM ('MANUAL', 'SCHEDULED');
CREATE TYPE "SourceSnapshotStatus" AS ENUM ('ACTIVE', 'DELETED', 'ERROR');
CREATE TYPE "IndexFailureCategory" AS ENUM ('PARSER', 'EMBEDDING', 'STORAGE', 'QUEUE', 'CANCELLED', 'UNKNOWN');

ALTER TYPE "DocumentVersionStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "IndexJobStatus" ADD VALUE 'CANCEL_REQUESTED';
ALTER TYPE "IndexJobStatus" ADD VALUE 'CANCELLED';
ALTER TYPE "IndexJobStatus" ADD VALUE 'DEAD_LETTER';

ALTER TABLE "Document"
  ADD COLUMN "sourceDeletedAt" TIMESTAMP(3),
  ADD COLUMN "sourceLocator" TEXT,
  ADD COLUMN "sourceMetadata" JSONB;

ALTER TABLE "DocumentIndexJob"
  ADD COLUMN "cancelledAt" TIMESTAMP(3),
  ADD COLUMN "deadLetteredAt" TIMESTAMP(3),
  ADD COLUMN "failureCategory" "IndexFailureCategory",
  ADD COLUMN "lastHeartbeatAt" TIMESTAMP(3),
  ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "processedChunks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "progressPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "sourceRefreshRunId" TEXT,
  ADD COLUMN "totalChunks" INTEGER;

ALTER TABLE "KnowledgeSource"
  ADD COLUMN "lastRefreshAt" TIMESTAMP(3),
  ADD COLUMN "lastRefreshMessage" TEXT,
  ADD COLUMN "lastRefreshStatus" "SourceRefreshStatus";
ALTER TABLE "KnowledgeSource" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "KnowledgeSource"
  ALTER COLUMN "type" TYPE "KnowledgeSourceType" USING "type"::"KnowledgeSourceType";
ALTER TABLE "KnowledgeSource" ALTER COLUMN "type" SET DEFAULT 'FILE';

CREATE TABLE "SharedFolderSourceConfig" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "rootPath" TEXT NOT NULL,
  "includeSubdirectories" BOOLEAN NOT NULL DEFAULT true,
  "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 60,
  "maxFiles" INTEGER NOT NULL DEFAULT 10000,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SharedFolderSourceConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SharedFolderSourceConfig_schedule_check" CHECK ("intervalMinutes" BETWEEN 5 AND 10080),
  CONSTRAINT "SharedFolderSourceConfig_max_files_check" CHECK ("maxFiles" BETWEEN 1 AND 100000)
);

CREATE TABLE "WebSourceConfig" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "timeoutMs" INTEGER NOT NULL DEFAULT 15000,
  "maxBytes" INTEGER NOT NULL DEFAULT 5242880,
  "maxRedirects" INTEGER NOT NULL DEFAULT 3,
  "scheduleEnabled" BOOLEAN NOT NULL DEFAULT false,
  "intervalMinutes" INTEGER NOT NULL DEFAULT 360,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WebSourceConfig_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebSourceConfig_timeout_check" CHECK ("timeoutMs" BETWEEN 1000 AND 60000),
  CONSTRAINT "WebSourceConfig_size_check" CHECK ("maxBytes" BETWEEN 1024 AND 26214400),
  CONSTRAINT "WebSourceConfig_redirect_check" CHECK ("maxRedirects" BETWEEN 0 AND 5),
  CONSTRAINT "WebSourceConfig_schedule_check" CHECK ("intervalMinutes" BETWEEN 5 AND 10080)
);

CREATE TABLE "SourceRefreshRun" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "trigger" "SourceRefreshTrigger" NOT NULL DEFAULT 'MANUAL',
  "status" "SourceRefreshStatus" NOT NULL DEFAULT 'QUEUED',
  "requestedById" TEXT,
  "queueJobId" TEXT,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "changedCount" INTEGER NOT NULL DEFAULT 0,
  "deletedCount" INTEGER NOT NULL DEFAULT 0,
  "unchangedCount" INTEGER NOT NULL DEFAULT 0,
  "successCount" INTEGER NOT NULL DEFAULT 0,
  "errorCount" INTEGER NOT NULL DEFAULT 0,
  "errorDetails" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceRefreshRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceSnapshot" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "locator" TEXT NOT NULL,
  "status" "SourceSnapshotStatus" NOT NULL DEFAULT 'ACTIVE',
  "size" INTEGER,
  "modifiedAt" TIMESTAMP(3),
  "checksum" TEXT,
  "etag" TEXT,
  "lastModified" TEXT,
  "fetchedAt" TIMESTAMP(3),
  "httpStatus" INTEGER,
  "canonicalUrl" TEXT,
  "metadata" JSONB,
  "documentId" TEXT,
  "lastSeenRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedFolderSourceConfig_sourceId_key" ON "SharedFolderSourceConfig"("sourceId");
CREATE UNIQUE INDEX "WebSourceConfig_sourceId_key" ON "WebSourceConfig"("sourceId");
CREATE INDEX "SourceRefreshRun_sourceId_createdAt_idx" ON "SourceRefreshRun"("sourceId", "createdAt");
CREATE INDEX "SourceRefreshRun_status_createdAt_idx" ON "SourceRefreshRun"("status", "createdAt");
CREATE INDEX "SourceSnapshot_sourceId_status_idx" ON "SourceSnapshot"("sourceId", "status");
CREATE INDEX "SourceSnapshot_documentId_idx" ON "SourceSnapshot"("documentId");
CREATE UNIQUE INDEX "SourceSnapshot_sourceId_locator_key" ON "SourceSnapshot"("sourceId", "locator");
CREATE UNIQUE INDEX "Document_sourceId_sourceLocator_key" ON "Document"("sourceId", "sourceLocator");
DROP INDEX "Document_sourceId_checksum_key";
CREATE INDEX "Document_sourceId_checksum_idx" ON "Document"("sourceId", "checksum");
CREATE INDEX "DocumentIndexJob_sourceRefreshRunId_status_idx" ON "DocumentIndexJob"("sourceRefreshRunId", "status");

ALTER TABLE "DocumentIndexJob"
  ADD CONSTRAINT "DocumentIndexJob_progress_check" CHECK ("progressPercent" BETWEEN 0 AND 100 AND "processedChunks" >= 0 AND ("totalChunks" IS NULL OR "totalChunks" >= 0)),
  ADD CONSTRAINT "DocumentIndexJob_attempts_check" CHECK ("attempt" >= 0 AND "maxAttempts" BETWEEN 1 AND 10),
  ADD CONSTRAINT "DocumentIndexJob_sourceRefreshRunId_fkey" FOREIGN KEY ("sourceRefreshRunId") REFERENCES "SourceRefreshRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SharedFolderSourceConfig" ADD CONSTRAINT "SharedFolderSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WebSourceConfig" ADD CONSTRAINT "WebSourceConfig_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceRefreshRun" ADD CONSTRAINT "SourceRefreshRun_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "KnowledgeSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SourceSnapshot" ADD CONSTRAINT "SourceSnapshot_lastSeenRunId_fkey" FOREIGN KEY ("lastSeenRunId") REFERENCES "SourceRefreshRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
