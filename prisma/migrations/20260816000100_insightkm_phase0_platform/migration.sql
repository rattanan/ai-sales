-- InsightKM uses pgvector for document and metadata embeddings.
-- The extension is enabled before vector-backed models are introduced so
-- deployments fail early when the PostgreSQL image is not pgvector-capable.
CREATE EXTENSION IF NOT EXISTS vector;
