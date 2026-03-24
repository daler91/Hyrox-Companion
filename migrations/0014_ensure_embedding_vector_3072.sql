-- Ensure embedding column is vector(3072) to match gemini-embedding-001 output.
-- Migration 0013 may have been applied before the ALTER COLUMN was added to it.
-- This is idempotent: Postgres allows SET TYPE to the same type as a no-op.
ALTER TABLE document_chunks ALTER COLUMN embedding SET DATA TYPE vector(3072);
