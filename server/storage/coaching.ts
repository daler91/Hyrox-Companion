import { inChunks, inSequence } from "@shared/inSequence";
import {
  type CoachingMaterial,
  coachingMaterials,
  type DocumentChunk,
  type InsertCoachingMaterial,
  type InsertDocumentChunk,
} from "@shared/schema";
import { and,eq, inArray, sql } from "drizzle-orm";

import { db } from "../db";
import { EMBEDDING_DIMENSIONS } from "../gemini/client";
import { vectorPool } from "../vectorDb";

/** A search result: the chunk and its cosine distance to the query. */
export type ScoredDocumentChunk = DocumentChunk & { distance: number };

/**
 * Titles of the athlete's materials among `materialIds`, by id. The ids come
 * from the vector database, so they are scoped to the user here as well.
 */
async function getMaterialTitles(userId: string, materialIds: string[]): Promise<Map<string, string>> {
  if (materialIds.length === 0) return new Map();
  const rows = await db
    .select({ id: coachingMaterials.id, title: coachingMaterials.title })
    .from(coachingMaterials)
    .where(and(eq(coachingMaterials.userId, userId), inArray(coachingMaterials.id, materialIds)));
  return new Map(rows.map((row) => [row.id, row.title]));
}

/**
 * A fingerprint of everything a retrieval for this athlete reads: their
 * materials on the main DB (the count, and the sum of their update times) and
 * their chunks on the vector DB (the same, by creation time). Creating,
 * editing or deleting a material, and every re-embed, which replaces the
 * chunks, changes it, on whichever replica it happened. The RAG cache keys on
 * it, so no replica serves a retrieval of data that has since changed.
 * AI34 (CODEBASE_ANALYSIS_2026-10-03)
 */
async function getRetrievalVersion(userId: string): Promise<string> {
  const [[materials], chunks] = await Promise.all([
    db
      .select({
        count: sql<number>`count(*)::int`,
        stamps: sql<string>`coalesce(sum(extract(epoch from ${coachingMaterials.updatedAt})), 0)::text`,
      })
      .from(coachingMaterials)
      .where(eq(coachingMaterials.userId, userId)),
    vectorPool.query<{ count: number; stamps: string }>(
      `SELECT count(*)::int AS count, coalesce(sum(extract(epoch from created_at)), 0)::text AS stamps
       FROM document_chunks
       WHERE user_id = $1`,
      [userId],
    ),
  ]);
  const [chunkRow] = chunks.rows;
  return `${materials?.count ?? 0}:${materials?.stamps ?? "0"}/${chunkRow?.count ?? 0}:${chunkRow?.stamps ?? "0"}`;
}

export class CoachingStorage {
  async listCoachingMaterials(userId: string): Promise<CoachingMaterial[]> {
    return await db
      .select()
      .from(coachingMaterials)
      .where(eq(coachingMaterials.userId, userId))
      .orderBy(coachingMaterials.createdAt);
  }

  async getCoachingMaterial(id: string, userId: string): Promise<CoachingMaterial | undefined> {
    const [material] = await db
      .select()
      .from(coachingMaterials)
      .where(and(eq(coachingMaterials.id, id), eq(coachingMaterials.userId, userId)));
    return material;
  }

  async createCoachingMaterial(data: InsertCoachingMaterial): Promise<CoachingMaterial> {
    const [material] = await db
      .insert(coachingMaterials)
      .values(data)
      .returning();
    return material;
  }

  async updateCoachingMaterial(
    id: string,
    updates: Partial<Pick<CoachingMaterial, "title" | "content" | "type">>,
    userId: string,
  ): Promise<CoachingMaterial | undefined> {
    const [material] = await db
      .update(coachingMaterials)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(coachingMaterials.id, id), eq(coachingMaterials.userId, userId)))
      .returning();
    return material;
  }

  async deleteCoachingMaterial(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(coachingMaterials)
      .where(and(eq(coachingMaterials.id, id), eq(coachingMaterials.userId, userId)))
      .returning({ id: coachingMaterials.id });
    return result.length > 0;
  }

  // RAG chunk methods — all use vectorPool (Supabase when VECTOR_DATABASE_URL is set)

  /**
   * Delete one material's RAG chunks from the vector database. Required on
   * per-material deletion for the same reason as `deleteChunksByUserId`: in
   * production `document_chunks` lives on `vectorPool`, a SEPARATE Postgres
   * instance with no foreign keys, so the main-DB cascade on
   * `coaching_materials` cannot reach it — without this call the deleted
   * material's text and embeddings stay at rest (retrieval drops chunks whose
   * material is gone, but only this removes them). Scoped by userId as
   * belt-and-braces so a caller can never purge another user's chunks via a
   * guessed material id.
   */
  async deleteChunksByMaterialId(materialId: string, userId: string): Promise<void> {
    await vectorPool.query(`DELETE FROM document_chunks WHERE material_id = $1 AND user_id = $2`, [
      materialId,
      userId,
    ]);
  }

  /**
   * Self-healing sweep: delete chunks whose coaching_materials row no longer
   * exists on the main DB (a per-material delete whose vector-side purge
   * failed, or rows orphaned before that purge existed). Cross-DB, so
   * existence is checked in bounded batches rather than a join — mirrors
   * pruneDanglingFoodEmbeddings.
   */
  async pruneDanglingChunks(): Promise<{ pruned: number }> {
    const CHECK_BATCH = 500;
    const existing = await vectorPool.query<{ material_id: string }>(
      `SELECT DISTINCT material_id FROM document_chunks`,
    );
    const ids = existing.rows.map((row) => row.material_id);
    if (ids.length === 0) return { pruned: 0 };

    const liveBatches = await inSequence(inChunks(ids, CHECK_BATCH), async (batch) => {
      const rows = await db
        .select({ id: coachingMaterials.id })
        .from(coachingMaterials)
        .where(inArray(coachingMaterials.id, batch));
      return rows.map((row) => row.id);
    });
    const live = new Set(liveBatches.flat());

    const dangling = ids.filter((id) => !live.has(id));
    if (dangling.length > 0) {
      await vectorPool.query(`DELETE FROM document_chunks WHERE material_id = ANY($1)`, [dangling]);
    }
    return { pruned: dangling.length };
  }

  /**
   * Delete ALL of a user's RAG chunks from the vector database. Required on
   * account deletion: `document_chunks` lives on `vectorPool`, a SEPARATE
   * Postgres instance in production (VECTOR_DATABASE_URL), so the main-DB FK
   * cascade on `users` cannot reach it — without this call the user's uploaded
   * coaching-material text and embeddings are orphaned (GDPR Art. 17).
   */
  async deleteChunksByUserId(userId: string): Promise<void> {
    await vectorPool.query(`DELETE FROM document_chunks WHERE user_id = $1`, [userId]);
  }

  async replaceChunks(materialId: string, chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]> {
    const client = await vectorPool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`DELETE FROM document_chunks WHERE material_id = $1`, [materialId]);
      if (chunks.length === 0) {
        await client.query("COMMIT");
        return [];
      }
      const BATCH_SIZE = 100;
      const results = await inSequence(inChunks(chunks, BATCH_SIZE), async (batch) => {
        const values: unknown[] = [];
        const rows = batch.map((c, j) => {
          const o = j * 5;
          values.push(c.materialId, c.userId, c.content, c.chunkIndex, c.embedding ? `[${c.embedding.join(",")}]` : null);
          return `(gen_random_uuid(), $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
        });
        const result = await client.query<DocumentChunk>(
          `INSERT INTO document_chunks ("id", "material_id", "user_id", "content", "chunk_index", "embedding")
           VALUES ${rows.join(", ")}
           RETURNING id, material_id AS "materialId", user_id AS "userId", content, chunk_index AS "chunkIndex", created_at AS "createdAt"`,
          values,
        );
        return result.rows;
      });
      await client.query("COMMIT");
      return results.flat();
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Ids of the athlete's `principles` materials — the short, always-true
   * guidance they typed into Settings, as opposed to uploaded documents.
   *
   * Read from the MAIN database on purpose. `document_chunks` lives in
   * `vectorPool`, which is a separate Neon instance whenever
   * VECTOR_DATABASE_URL is set (`server/vectorDb.ts`), so the obvious
   * chunks-join-materials query would work in single-DB mode and fail in the
   * split deployment.
   */
  async listPrincipleMaterialIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ id: coachingMaterials.id })
      .from(coachingMaterials)
      .where(and(eq(coachingMaterials.userId, userId), eq(coachingMaterials.type, "principles")))
      .orderBy(coachingMaterials.createdAt);
    return rows.map((row) => row.id);
  }

  // Uses no instance state, so it is a module function bound here, as
  // NutritionStorage binds its own: storage.coaching.getMaterialTitles() and
  // its mocks still work.
  readonly getMaterialTitles = getMaterialTitles;

  readonly getRetrievalVersion = getRetrievalVersion;

  /**
   * Chunks belonging to `materialIds`, oldest chunk first, capped.
   *
   * Scoped by user id as well as material id: the caller resolved those ids
   * from a different database, so this must not take them on trust.
   */
  async listChunksForMaterials(
    userId: string,
    materialIds: string[],
    limit: number,
  ): Promise<DocumentChunk[]> {
    if (materialIds.length === 0 || limit <= 0) return [];
    const result = await vectorPool.query<DocumentChunk>(
      `SELECT id, material_id AS "materialId", user_id AS "userId", content, chunk_index AS "chunkIndex", created_at AS "createdAt"
       FROM document_chunks
       WHERE user_id = $1 AND material_id = ANY($2::varchar[])
       ORDER BY created_at, chunk_index
       LIMIT $3`,
      [userId, materialIds, limit],
    );
    return result.rows;
  }

  /**
   * The athlete's `topK` nearest chunks, nearest first, each with its cosine
   * distance to the query (0 = same direction, 2 = opposite).
   *
   * An exact search over this athlete's own chunks. Ordering by the
   * `halfvec` cast let the planner walk the HNSW index, which is shared by
   * every athlete and returns at most `hnsw.ef_search` (default 40) of the
   * nearest chunks overall before `user_id` is filtered, so an athlete could
   * get fewer than `topK` of their own, or none. The full-precision distance
   * below matches no index, so the planner reads the athlete's chunks by
   * `idx_document_chunks_user_id` and sorts them: always `topK` when they have
   * that many, on any pgvector version, at a cost that grows with their own
   * corpus only. AI33 (CODEBASE_ANALYSIS_2026-10-03)
   */
  async searchChunksByEmbedding(
    userId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<ScoredDocumentChunk[]> {
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    // EMBEDDING_DIMENSIONS is a trusted numeric constant, safe to interpolate.
    const result = await vectorPool.query<ScoredDocumentChunk>(
      `SELECT id, material_id AS "materialId", user_id AS "userId", content, chunk_index AS "chunkIndex", created_at AS "createdAt",
              embedding <=> $2::vector(${EMBEDDING_DIMENSIONS}) AS distance
       FROM document_chunks
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY distance
       LIMIT $3`,
      [userId, embeddingStr, topK],
    );
    return result.rows;
  }

  async getChunkCountsByMaterial(userId: string): Promise<{ materialId: string; chunkCount: number; hasEmbeddings: boolean }[]> {
    const result = await vectorPool.query(
      `SELECT material_id AS "materialId",
              COUNT(*)::int AS "chunkCount",
              COUNT(embedding)::int AS "embeddedCount"
       FROM document_chunks
       WHERE user_id = $1
       GROUP BY material_id`,
      [userId],
    );
    return result.rows.map((r: { materialId: string; chunkCount: number; embeddedCount: number }) => ({
      materialId: r.materialId,
      chunkCount: r.chunkCount,
      hasEmbeddings: r.embeddedCount > 0,
    }));
  }

  async hasChunksForUser(userId: string): Promise<boolean> {
    const result = await vectorPool.query(
      `SELECT id FROM document_chunks WHERE user_id = $1 LIMIT 1`,
      [userId],
    );
    return result.rows.length > 0;
  }

  /** Return the dimension of the first stored embedding for a user, or null if none. */
  async getStoredEmbeddingDimension(userId: string): Promise<number | null> {
    const result = await vectorPool.query(
      `SELECT array_length(string_to_array(embedding::text, ','), 1) AS dims
       FROM document_chunks
       WHERE user_id = $1 AND embedding IS NOT NULL
       LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    return (result.rows[0] as { dims: number | null }).dims ?? null;
  }
}
