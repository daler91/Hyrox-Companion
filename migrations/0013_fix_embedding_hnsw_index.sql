-- Fix: Migration 0012 incorrectly changed embedding column to vector(768).
-- The gemini-embedding-001 model returns 3072-dim vectors.
-- Restore the correct dimension, clear stale embeddings, and rebuild the index.

DROP INDEX IF EXISTS idx_document_chunks_embedding_hnsw;
--> statement-breakpoint

ALTER TABLE document_chunks ALTER COLUMN embedding SET DATA TYPE vector(3072);
--> statement-breakpoint

UPDATE document_chunks SET embedding = NULL WHERE embedding IS NOT NULL;
--> statement-breakpoint

CREATE INDEX idx_document_chunks_embedding_hnsw
  ON document_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
