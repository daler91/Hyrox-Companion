-- document_chunks table is now managed on the vector database (Neon/VECTOR_DATABASE_URL).
-- This migration is a no-op on the main database.
-- The vector DB schema is created at startup by ensureVectorSchema() in maintenance.ts.
SELECT 1;
