-- Fix: Drop the HNSW index that was created for vector(3072) in migration 0010.
-- Migration 0012 changed the column to vector(768) but left the stale index.
-- Clear any corrupt embeddings and recreate the index for the correct dimension.

DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;
--> statement-breakpoint

UPDATE document_chunks SET embedding = NULL;
--> statement-breakpoint

CREATE INDEX idx_document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
