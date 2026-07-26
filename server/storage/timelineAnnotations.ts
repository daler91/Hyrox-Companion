import type {
  InsertTimelineAnnotation,
  TimelineAnnotation,
  UpdateTimelineAnnotation,
} from "@shared/schema";
import { timelineAnnotations } from "@shared/schema";
import { and, asc, eq } from "drizzle-orm";

import { db } from "../db";

/**
 * CRUD over the `timeline_annotations` table. Every method is scoped by
 * `userId` at the query level so a compromised handler can't leak another
 * user's data. Returning rows preserve the original DB types (date as
 * YYYY-MM-DD strings, timestamps as Date) — the route handlers serialize
 * them to JSON without further transformation.
 */
export class TimelineAnnotationsStorage {
  async list(userId: string): Promise<TimelineAnnotation[]> {
    return db
      .select()
      .from(timelineAnnotations)
      .where(eq(timelineAnnotations.userId, userId))
      .orderBy(asc(timelineAnnotations.startDate));
  }

  async findById(
    userId: string,
    id: string,
  ): Promise<TimelineAnnotation | undefined> {
    const [row] = await db
      .select()
      .from(timelineAnnotations)
      .where(
        and(
          eq(timelineAnnotations.id, id),
          eq(timelineAnnotations.userId, userId),
        ),
      );
    return row;
  }

  async create(
    userId: string,
    data: InsertTimelineAnnotation,
  ): Promise<TimelineAnnotation> {
    const [row] = await db
      .insert(timelineAnnotations)
      .values({
        userId,
        startDate: data.startDate,
        endDate: data.endDate,
        type: data.type,
        note: data.note ?? null,
      })
      .returning();
    return row;
  }

  async update(
    userId: string,
    id: string,
    data: UpdateTimelineAnnotation,
  ): Promise<TimelineAnnotation | undefined> {
    const [row] = await db
      .update(timelineAnnotations)
      .set({
        ...(data.startDate !== undefined && { startDate: data.startDate }),
        ...(data.endDate !== undefined && { endDate: data.endDate }),
        ...(data.type !== undefined && { type: data.type }),
        ...(data.note !== undefined && { note: data.note }),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(timelineAnnotations.id, id),
          eq(timelineAnnotations.userId, userId),
        ),
      )
      .returning();
    return row;
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await db
      .delete(timelineAnnotations)
      .where(
        and(
          eq(timelineAnnotations.id, id),
          eq(timelineAnnotations.userId, userId),
        ),
      )
      .returning({ id: timelineAnnotations.id });
    return result.length > 0;
  }
}
