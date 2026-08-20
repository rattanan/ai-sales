CREATE TYPE "UserMemoryCategory" AS ENUM ('PREFERENCE', 'DEPARTMENT', 'PROJECT');
CREATE TYPE "MemoryConsentStatus" AS ENUM ('GRANTED', 'REVOKED');
CREATE TYPE "BusinessInsightJobStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'INSUFFICIENT_DATA', 'FAILED');

ALTER TABLE "ChatMessageFeedback" ADD COLUMN "reason" TEXT;
ALTER TABLE "ChatMessageFeedback" ADD CONSTRAINT "ChatMessageFeedback_reason_check"
CHECK ("reason" IS NULL OR "reason" IN ('CORRECT', 'CLEAR', 'MISSING_INFORMATION', 'INCORRECT', 'OUTDATED', 'OTHER'));

ALTER TABLE "Conversation"
ADD COLUMN "authMode" "AuthenticationMode" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "departmentName" TEXT,
ADD COLUMN "organizationUnitId" TEXT,
ADD COLUMN "projectId" TEXT,
ADD COLUMN "projectName" TEXT;

-- Snapshot current organization scope for existing conversation history.
UPDATE "Conversation" AS conversation
SET "organizationUnitId" = member."organizationUnitId",
    "departmentName" = unit."name"
FROM "OrganizationMember" AS member
LEFT JOIN "OrganizationUnit" AS unit ON unit."id" = member."organizationUnitId"
WHERE member."organizationId" = conversation."organizationId"
  AND member."userId" = conversation."userId";

UPDATE "Conversation" AS conversation
SET "projectId" = scoped."projectId",
    "projectName" = scoped."projectName"
FROM (
  SELECT member."organizationId", member."userId", MIN(project."id") AS "projectId", MIN(project."name") AS "projectName"
  FROM "OrganizationMember" AS member
  JOIN "UserProject" AS membership_project ON membership_project."organizationMemberId" = member."id"
  JOIN "OrganizationProject" AS project ON project."id" = membership_project."projectId"
  GROUP BY member."organizationId", member."userId"
  HAVING COUNT(*) = 1
) AS scoped
WHERE scoped."organizationId" = conversation."organizationId"
  AND scoped."userId" = conversation."userId";

ALTER TABLE "SystemRetentionPolicy"
ADD COLUMN "memoryRetentionDays" INTEGER NOT NULL DEFAULT 365;
ALTER TABLE "SystemRetentionPolicy" ADD CONSTRAINT "SystemRetentionPolicy_memory_days_check"
CHECK ("memoryRetentionDays" BETWEEN 1 AND 3650);

CREATE TABLE "ConversationSummary" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "summary" TEXT NOT NULL,
    "messageIds" TEXT[],
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ConversationSummary_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ConversationSummary_evidence_check" CHECK (cardinality("messageIds") > 0 AND length("summary") > 0)
);

CREATE TABLE "UserMemory" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "category" "UserMemoryCategory" NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceMessageIds" TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserMemory_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "UserMemory_length_check" CHECK (length("key") BETWEEN 2 AND 80 AND length("value") BETWEEN 1 AND 500),
    CONSTRAINT "UserMemory_secret_key_check" CHECK ("key" !~* '(password|passcode|secret|token|credential|api.?key|authorization|private.?key)'),
    CONSTRAINT "UserMemory_secret_value_check" CHECK ("value" !~* '(-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer[[:space:]]+[A-Za-z0-9._~+/-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)')
);

CREATE TABLE "MemoryConsent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "botId" TEXT,
    "status" "MemoryConsentStatus" NOT NULL,
    "categories" "UserMemoryCategory"[],
    "policyVersion" TEXT NOT NULL DEFAULT 'memory-consent-v1',
    "reason" TEXT,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryConsent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MemoryConsent_categories_check" CHECK (cardinality("categories") BETWEEN 1 AND 3)
);

CREATE TABLE "BusinessInsightJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "botId" TEXT,
    "organizationUnitId" TEXT,
    "projectId" TEXT,
    "userFilterId" TEXT,
    "dateFrom" TIMESTAMP(3) NOT NULL,
    "dateTo" TIMESTAMP(3) NOT NULL,
    "status" "BusinessInsightJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "conversationCount" INTEGER NOT NULL DEFAULT 0,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "limitation" TEXT,
    "scopeMetadata" JSONB NOT NULL,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BusinessInsightJob_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessInsightJob_range_check" CHECK ("dateFrom" <= "dateTo" AND "dateTo" - "dateFrom" <= INTERVAL '367 days'),
    CONSTRAINT "BusinessInsightJob_counts_check" CHECK ("conversationCount" >= 0 AND "messageCount" >= 0)
);

CREATE TABLE "BusinessInsightSnapshot" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "metrics" JSONB NOT NULL,
    "trends" JSONB NOT NULL,
    "topics" JSONB NOT NULL,
    "knowledgeGaps" JSONB NOT NULL,
    "findings" JSONB NOT NULL,
    "evidenceAggregate" JSONB NOT NULL,
    "limitations" TEXT[],
    "conversationCount" INTEGER NOT NULL,
    "messageCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessInsightSnapshot_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BusinessInsightSnapshot_counts_check" CHECK ("version" > 0 AND "conversationCount" >= 0 AND "messageCount" >= 0)
);

CREATE INDEX "ConversationSummary_conversationId_createdAt_idx" ON "ConversationSummary"("conversationId", "createdAt");
CREATE UNIQUE INDEX "ConversationSummary_conversationId_version_key" ON "ConversationSummary"("conversationId", "version");
CREATE INDEX "UserMemory_organizationId_userId_expiresAt_idx" ON "UserMemory"("organizationId", "userId", "expiresAt");
CREATE INDEX "UserMemory_botId_userId_category_idx" ON "UserMemory"("botId", "userId", "category");
CREATE UNIQUE INDEX "UserMemory_identity_key" ON "UserMemory"("organizationId", "userId", COALESCE("botId", ''), "category", "key");
CREATE INDEX "MemoryConsent_organizationId_userId_botId_createdAt_idx" ON "MemoryConsent"("organizationId", "userId", "botId", "createdAt");
CREATE INDEX "BusinessInsightJob_workspaceId_requestedById_createdAt_idx" ON "BusinessInsightJob"("workspaceId", "requestedById", "createdAt");
CREATE INDEX "BusinessInsightJob_organizationId_organizationUnitId_projec_idx" ON "BusinessInsightJob"("organizationId", "organizationUnitId", "projectId", "dateFrom", "dateTo");
CREATE INDEX "BusinessInsightJob_botId_createdAt_idx" ON "BusinessInsightJob"("botId", "createdAt");
CREATE INDEX "BusinessInsightSnapshot_jobId_createdAt_idx" ON "BusinessInsightSnapshot"("jobId", "createdAt");
CREATE UNIQUE INDEX "BusinessInsightSnapshot_jobId_version_key" ON "BusinessInsightSnapshot"("jobId", "version");
CREATE INDEX "Conversation_organizationId_organizationUnitId_projectId_cr_idx" ON "Conversation"("organizationId", "organizationUnitId", "projectId", "createdAt");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OrganizationProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ConversationSummary" ADD CONSTRAINT "ConversationSummary_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserMemory" ADD CONSTRAINT "UserMemory_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryConsent" ADD CONSTRAINT "MemoryConsent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryConsent" ADD CONSTRAINT "MemoryConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MemoryConsent" ADD CONSTRAINT "MemoryConsent_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MemoryConsent" ADD CONSTRAINT "MemoryConsent_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_organizationUnitId_fkey" FOREIGN KEY ("organizationUnitId") REFERENCES "OrganizationUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightJob" ADD CONSTRAINT "BusinessInsightJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "OrganizationProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "BusinessInsightSnapshot" ADD CONSTRAINT "BusinessInsightSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "BusinessInsightJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
