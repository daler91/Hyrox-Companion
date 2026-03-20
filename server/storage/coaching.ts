import {
  coachingMaterials,
  type CoachingMaterial,
  type InsertCoachingMaterial,
} from "@shared/schema";
import { db } from "../db";
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
}
