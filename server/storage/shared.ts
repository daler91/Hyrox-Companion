import {
  type ExerciseSet,
  workoutLogs,
} from "@shared/schema";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";

import { db } from "../db";

// This helper only walks workoutLogs → exerciseSets, so every returned row
// is a logged set with a non-null workoutLogId. The narrowed return type
// (workoutLogId: string) lets analytics/export code treat the id as present
// without re-checking — the base ExerciseSet type allows null because
// prescribed sets live under planDayId instead.
export type LoggedExerciseSetWithDate = Omit<ExerciseSet, "workoutLogId"> & {
  workoutLogId: string;
  date: string;
};

export async function queryExerciseSetsWithDates(
  userId: string,
  filters?: {
    exerciseName?: string;
    from?: string;
    to?: string;
  }
): Promise<LoggedExerciseSetWithDate[]> {
  // Relational query: fetch the user's workout logs (with optional date range)
  // and pull their exercise sets. The output flattens sets + the parent log's
  // date to match the prior shape. An optional exerciseName filter is applied
  // at the nested-relation level so it runs in SQL.
  const conditions: SQL[] = [eq(workoutLogs.userId, userId)];
  if (filters?.from) conditions.push(gte(workoutLogs.date, filters.from));
  if (filters?.to) conditions.push(lte(workoutLogs.date, filters.to));

  const logs = await db.query.workoutLogs.findMany({
    where: and(...conditions),
    columns: { id: true, date: true },
    with: {
      exerciseSets: filters?.exerciseName
        ? { where: (es, { eq: innerEq }) => innerEq(es.exerciseName, filters.exerciseName!) }
        : true,
    },
    orderBy: desc(workoutLogs.date),
  });

  const result: LoggedExerciseSetWithDate[] = [];
  for (const log of logs) {
    for (const set of log.exerciseSets) {
      result.push({ ...set, workoutLogId: log.id, date: log.date });
    }
  }
  return result;
}
