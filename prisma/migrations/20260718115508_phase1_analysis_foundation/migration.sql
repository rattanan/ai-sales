-- CreateEnum
CREATE TYPE "AnalysisJobStatus" AS ENUM ('QUEUED', 'RUNNING', 'WAITING_FOR_APPROVAL', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AnalysisStage" AS ENUM ('PREPARING_METADATA', 'ANALYZING_SCHEMA', 'IDENTIFYING_BUSINESS_ENTITIES', 'RECOMMENDING_KPIS', 'GENERATING_QUERIES', 'VALIDATING_QUERIES', 'EXECUTING_QUERIES', 'GENERATING_WIDGETS', 'GENERATING_INSIGHTS', 'FINALIZING_DASHBOARD');

-- CreateEnum
CREATE TYPE "AnalysisArtifactType" AS ENUM ('METADATA_CONTEXT', 'SCHEMA_ANALYSIS', 'KPI_RECOMMENDATIONS', 'DASHBOARD_PLAN', 'WIDGET_DEFINITIONS', 'GENERATED_INSIGHTS');

-- CreateEnum
CREATE TYPE "AnalysisRecommendationType" AS ENUM ('KPI', 'WIDGET');

-- CreateEnum
CREATE TYPE "AnalysisRecommendationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QueryValidationStatus" AS ENUM ('PROPOSED', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "QueryExecutionStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "AnalysisJob" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "dashboardId" TEXT NOT NULL,
    "dataSourceId" TEXT NOT NULL,
    "status" "AnalysisJobStatus" NOT NULL DEFAULT 'QUEUED',
    "currentStage" "AnalysisStage" NOT NULL DEFAULT 'PREPARING_METADATA',
    "progressPercent" INTEGER NOT NULL DEFAULT 0,
    "requestedById" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "resultSummary" JSONB,
    "runVersion" INTEGER NOT NULL DEFAULT 1,
    "lastHeartbeatAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "finalVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisArtifact" (
    "id" TEXT NOT NULL,
    "analysisJobId" TEXT NOT NULL,
    "type" "AnalysisArtifactType" NOT NULL,
    "stage" "AnalysisStage" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "promptVersion" TEXT,
    "inputHash" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalysisArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalysisRecommendation" (
    "id" TEXT NOT NULL,
    "analysisJobId" TEXT NOT NULL,
    "artifactId" TEXT,
    "type" "AnalysisRecommendationType" NOT NULL,
    "status" "AnalysisRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalysisRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryDefinition" (
    "id" TEXT NOT NULL,
    "analysisJobId" TEXT NOT NULL,
    "recommendationId" TEXT,
    "purpose" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "sqlHash" TEXT NOT NULL,
    "validationStatus" "QueryValidationStatus" NOT NULL DEFAULT 'PROPOSED',
    "validationErrors" JSONB,
    "resultSchema" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QueryDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QueryExecution" (
    "id" TEXT NOT NULL,
    "analysisJobId" TEXT NOT NULL,
    "queryDefinitionId" TEXT NOT NULL,
    "status" "QueryExecutionStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "rowCount" INTEGER,
    "previewRows" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "requestId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QueryExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiResponseCache" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiResponseCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_requestId_key" ON "AnalysisJob"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisJob_finalVersionId_key" ON "AnalysisJob"("finalVersionId");

-- CreateIndex
CREATE INDEX "AnalysisJob_workspaceId_status_updatedAt_idx" ON "AnalysisJob"("workspaceId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_dashboardId_createdAt_idx" ON "AnalysisJob"("dashboardId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisJob_dataSourceId_createdAt_idx" ON "AnalysisJob"("dataSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalysisArtifact_analysisJobId_stage_idx" ON "AnalysisArtifact"("analysisJobId", "stage");

-- CreateIndex
CREATE INDEX "AnalysisArtifact_inputHash_idx" ON "AnalysisArtifact"("inputHash");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisArtifact_analysisJobId_type_revision_key" ON "AnalysisArtifact"("analysisJobId", "type", "revision");

-- CreateIndex
CREATE INDEX "AnalysisRecommendation_analysisJobId_status_type_idx" ON "AnalysisRecommendation"("analysisJobId", "status", "type");

-- CreateIndex
CREATE UNIQUE INDEX "AnalysisRecommendation_analysisJobId_type_externalId_revisi_key" ON "AnalysisRecommendation"("analysisJobId", "type", "externalId", "revision");

-- CreateIndex
CREATE INDEX "QueryDefinition_analysisJobId_validationStatus_idx" ON "QueryDefinition"("analysisJobId", "validationStatus");

-- CreateIndex
CREATE INDEX "QueryDefinition_sqlHash_idx" ON "QueryDefinition"("sqlHash");

-- CreateIndex
CREATE INDEX "QueryExecution_analysisJobId_createdAt_idx" ON "QueryExecution"("analysisJobId", "createdAt");

-- CreateIndex
CREATE INDEX "QueryExecution_queryDefinitionId_createdAt_idx" ON "QueryExecution"("queryDefinitionId", "createdAt");

-- CreateIndex
CREATE INDEX "AiResponseCache_workspaceId_expiresAt_idx" ON "AiResponseCache"("workspaceId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "AiResponseCache_workspaceId_provider_model_promptVersion_in_key" ON "AiResponseCache"("workspaceId", "provider", "model", "promptVersion", "inputHash");

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_dashboardId_fkey" FOREIGN KEY ("dashboardId") REFERENCES "Dashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_dataSourceId_fkey" FOREIGN KEY ("dataSourceId") REFERENCES "DataSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisJob" ADD CONSTRAINT "AnalysisJob_finalVersionId_fkey" FOREIGN KEY ("finalVersionId") REFERENCES "DashboardVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisArtifact" ADD CONSTRAINT "AnalysisArtifact_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalysisRecommendation" ADD CONSTRAINT "AnalysisRecommendation_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryDefinition" ADD CONSTRAINT "QueryDefinition_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryDefinition" ADD CONSTRAINT "QueryDefinition_recommendationId_fkey" FOREIGN KEY ("recommendationId") REFERENCES "AnalysisRecommendation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryExecution" ADD CONSTRAINT "QueryExecution_analysisJobId_fkey" FOREIGN KEY ("analysisJobId") REFERENCES "AnalysisJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QueryExecution" ADD CONSTRAINT "QueryExecution_queryDefinitionId_fkey" FOREIGN KEY ("queryDefinitionId") REFERENCES "QueryDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiResponseCache" ADD CONSTRAINT "AiResponseCache_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
