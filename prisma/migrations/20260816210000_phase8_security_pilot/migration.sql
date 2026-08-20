-- Phase 8: expanded PDPA controls, provider fallback policy, and pilot indexes.

ALTER TABLE "LlmProvider"
  ADD COLUMN IF NOT EXISTS "fallbackEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PiiMaskingPolicy"
  ADD COLUMN IF NOT EXISTS "maskPassport" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maskHealth" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maskReligion" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "maskBiometric" BOOLEAN NOT NULL DEFAULT true;

CREATE UNIQUE INDEX IF NOT EXISTS "LlmProvider_one_fallback_per_org"
  ON "LlmProvider"("organizationId")
  WHERE "fallbackEnabled" = true;

CREATE INDEX IF NOT EXISTS "ChatMessage_role_createdAt_idx"
  ON "ChatMessage"("role", "createdAt");

CREATE INDEX IF NOT EXISTS "ChatMessage_assistant_error_slo_idx"
  ON "ChatMessage"("createdAt", "errorCode", "latencyMs")
  WHERE "role" = 'ASSISTANT';

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "Conversation_title_trgm_idx"
  ON "Conversation" USING GIN ("title" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "ChatMessage_content_trgm_idx"
  ON "ChatMessage" USING GIN ("content" gin_trgm_ops);

-- The embedding column intentionally supports multiple providers/dimensions.
-- Expression indexes keep each HNSW index dimension-safe. Retrieval casts to
-- one of these dimensions when available and falls back to an exact scan for
-- uncommon dimensions.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_384_idx"
  ON "DocumentChunk" USING hnsw ((embedding::vector(384)) vector_cosine_ops)
  WHERE "embeddingDimension" = 384;

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_768_idx"
  ON "DocumentChunk" USING hnsw ((embedding::vector(768)) vector_cosine_ops)
  WHERE "embeddingDimension" = 768;

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_1024_idx"
  ON "DocumentChunk" USING hnsw ((embedding::vector(1024)) vector_cosine_ops)
  WHERE "embeddingDimension" = 1024;

CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_1536_idx"
  ON "DocumentChunk" USING hnsw ((embedding::vector(1536)) vector_cosine_ops)
  WHERE "embeddingDimension" = 1536;

-- pgvector HNSW supports at most 2,000 dimensions. Retrieval for 3,072 and
-- other uncommon dimensions intentionally keeps the bounded exact-scan path.
