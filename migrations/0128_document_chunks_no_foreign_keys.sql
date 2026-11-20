-- document_chunks lives on the vector database (ensureVectorSchema() in
-- server/maintenance.ts), which has no users or coaching_materials table, so
-- the real table has no foreign keys. The schema used to declare two; this
-- drops them wherever `drizzle-kit push` created them (a local or test
-- database). On the main database the table does not exist and both
-- statements do nothing. Tech debt #47.
ALTER TABLE IF EXISTS "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_material_id_coaching_materials_id_fk";
--> statement-breakpoint
ALTER TABLE IF EXISTS "document_chunks" DROP CONSTRAINT IF EXISTS "document_chunks_user_id_users_id_fk";
