UPDATE "WebSourceConfig"
SET "allowedDomains" = ARRAY[]::TEXT[]
WHERE "allowedDomains" IS NULL;

ALTER TABLE "WebSourceConfig"
  ALTER COLUMN "allowedDomains" SET NOT NULL;

ALTER TABLE "SourceRefreshRun"
  ADD CONSTRAINT "SourceRefreshRun_counts_check"
  CHECK (
    "newCount" >= 0 AND "changedCount" >= 0 AND "deletedCount" >= 0
    AND "unchangedCount" >= 0 AND "successCount" >= 0 AND "errorCount" >= 0
  );

ALTER TABLE "SourceSnapshot"
  ADD CONSTRAINT "SourceSnapshot_values_check"
  CHECK (
    (size IS NULL OR size >= 0)
    AND ("httpStatus" IS NULL OR "httpStatus" BETWEEN 100 AND 599)
  );
