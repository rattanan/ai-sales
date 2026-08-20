ALTER TABLE "KnowledgeSource"
  ADD COLUMN "previewSummary" TEXT,
  ADD COLUMN "previewSummaryAt" TIMESTAMP(3),
  ADD COLUMN "previewSummaryModel" TEXT;

ALTER TABLE "DataSource"
  ADD COLUMN "previewSummary" TEXT,
  ADD COLUMN "previewSummaryAt" TIMESTAMP(3),
  ADD COLUMN "previewSummaryModel" TEXT;

ALTER TABLE "LegacyApi"
  ADD COLUMN "previewSummary" TEXT,
  ADD COLUMN "previewSummaryAt" TIMESTAMP(3),
  ADD COLUMN "previewSummaryModel" TEXT;

ALTER TABLE "WebSourceConfig"
  ADD COLUMN "crawlDepth" INTEGER NOT NULL DEFAULT 2,
  ADD COLUMN "maxPages" INTEGER NOT NULL DEFAULT 100;
