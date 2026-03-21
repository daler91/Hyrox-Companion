import {
  coachingMaterials,
  documentChunks,
  type CoachingMaterial,
  type InsertCoachingMaterial,
  type DocumentChunk,
  type InsertDocumentChunk,
} from "@shared/schema";
import { db } from "../db";
import { pool } from "../db";
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

  async searchChunksByEmbedding(
    userId: string,
    queryEmbedding: number[],
    topK: number,
  ): Promise<DocumentChunk[]> {
    // Use raw SQL for pgvector cosine similarity search
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

  async hasChunksForUser(userId: string): Promise<boolean> {
    const result = await db
      .select({ id: documentChunks.id })
      .from(documentChunks)
      .where(eq(documentChunks.userId, userId))
      .limit(1);
    return result.length > 0;
  }
}
