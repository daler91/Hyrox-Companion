-- Convert the embedding column from text (JSON string) to native pgvector type.
-- Existing data stored as "[0.1,0.2,...]" is valid pgvector literal syntax.
ALTER TABLE "document_chunks"
  ALTER COLUMN "embedding" TYPE vector(3072)
  USING embedding::vector(3072);
--> statement-breakpoint

-- Create an HNSW index for fast cosine similarity search.
CREATE INDEX "idx_document_chunks_embedding_hnsw"
  ON "document_chunks"
  USING hnsw ("embedding" vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
