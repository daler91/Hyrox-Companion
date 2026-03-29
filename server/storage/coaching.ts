import {
  coachingMaterials,
  type CoachingMaterial,
  type InsertCoachingMaterial,
  type DocumentChunk,
  type InsertDocumentChunk,
} from "@shared/schema";
import { db } from "../db";
import { vectorPool } from "../vectorDb";
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

  // RAG chunk methods — all use vectorPool (Supabase when VECTOR_DATABASE_URL is set)

  async insertChunks(chunks: InsertDocumentChunk[]): Promise<DocumentChunk[]> {
    if (chunks.length === 0) return [];
    const BATCH_SIZE = 100;
    const results: DocumentChunk[] = [];
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const cols = '("id", "material_id", "user_id", "content", "chunk_index", "embedding")';
      const values = batch.flatMap((c) => [
        c.materialId,
        c.userId,
        c.content,
        c.chunkIndex,
        c.embedding ? `[${c.embedding.join(",")}]` : null,
      ]);
      const result = await vectorPool.query<DocumentChunk>(
        `INSERT INTO document_chunks ${cols} VALUES ${batch
          .map((_, j) => {
            const o = j * 5;
            return `(gen_random_uuid(), $${o + 1}, $${o + 2}, $${o + 3}, $${o + 4}, $${o + 5})`;
          })
          .join(", ")} RETURNING id, material_id AS "materialId", user_id AS "userId", content, chunk_index AS "chunkIndex", created_at AS "createdAt"`,
        values,
      );
      results.push(...result.rows);
    }
    return results;
  }

  async deleteChunksByMaterialId(materialId: string): Promise<void> {
    await vectorPool.query(`DELETE FROM document_chunks WHERE material_id = $1`, [materialId]);
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
      const results: DocumentChunk[] = [];
      for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
        const batch = chunks.slice(i, i + BATCH_SIZE);
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
        results.push(...result.rows);
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async searchChunksByEmbedding(
    userId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<DocumentChunk[]> {
    const embeddingStr = `[${queryEmbedding.join(",")}]`;
    const result = await vectorPool.query<DocumentChunk>(
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
