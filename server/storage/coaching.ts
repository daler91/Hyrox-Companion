import {
  coachingMaterials,
  documentChunks,
  type CoachingMaterial,
  type InsertCoachingMaterial,
  type DocumentChunk,
  type InsertDocumentChunk,
} from "@shared/schema";
import { db, pool } from "../db";
import { eq, and } from "drizzle-orm";

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

  // RAG chunk methods

  async insertChunks(chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]> {
    if (chunks.length === 0) return [];
    return await db.insert(documentChunks).values(chunks).returning();
  }

  async deleteChunksByMaterialId(materialId: string): Promise<void> {
    await db.delete(documentChunks).where(eq(documentChunks.materialId, materialId));
  }

  async replaceChunks(materialId: string, chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]> {
    return await db.transaction(async (tx) => {
      await tx.delete(documentChunks).where(eq(documentChunks.materialId, materialId));
      if (chunks.length === 0) return [];
      // Batch inserts to avoid exceeding statement size limits for large documents
      const BATCH_SIZE = 100;
      const results: DocumentChunk[] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
        const inserted = await tx.insert(documentChunks).values(batch).returning();
        results.push(...inserted);
      }
      return results;
    });
  }

  async searchChunksByEmbedding(
    userId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<DocumentChunk[]> {
    // IMPORTANT: The `embedding` column is stored as `text` in production (Drizzle has no native vector type).
    // Always cast to `::vector` before using pgvector operators like `<=>`.
    // Similarly, avoid pgvector utility functions (e.g. `vector_dims()`) — use portable SQL instead.
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const result = await pool.query(
      `SELECT id, material_id AS "materialId", user_id AS "userId", content, chunk_index AS "chunkIndex", created_at AS "createdAt"
       FROM document_chunks
       WHERE user_id = $1 AND embedding IS NOT NULL
       ORDER BY embedding::vector <=> $2::vector
       LIMIT $3`,
      [userId, embeddingStr, topK],
    );
    return result.rows;
  }

  async getChunkCountsByMaterial(userId: string): Promise<{ materialId: string; chunkCount: number; hasEmbeddings: boolean }[]> {
    const result = await pool.query(
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
    const result = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(eq(documentChunks.userId, userId))
      .limit(1);
    return result.length > 0;
  }

  /** Return the dimension of the first stored embedding for a user, or null if none. */
  async getStoredEmbeddingDimension(userId: string): Promise<number | null> {
    const result = await pool.query(
      `SELECT array_length(string_to_array(embedding::text, ','), 1) AS dims
       FROM document_chunks
       WHERE user_id = $1 AND embedding IS NOT NULL
       LIMIT 1`,
      [userId],
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].dims ?? null;
  }
}
