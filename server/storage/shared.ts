import {
  type ExerciseSet,
  workoutLogs,
} from "@shared/schema";
import { and, desc, eq, gte, lte, type SQL } from "drizzle-orm";

import { db } from "../db";
import { logger } from "../logger";

// This helper only walks workoutLogs → exerciseSets, so every returned row
// is a logged set with a non-null workoutLogId. The narrowed return type
// (workoutLogId: string) lets analytics/export code treat the id as present
// without re-checking — the base ExerciseSet type allows null because
// prescribed sets live under planDayId instead.
export type LoggedExerciseSetWithDate = Omit<ExerciseSet, "workoutLogId"> & {
  workoutLogId: string;
  date: string;
};

// Upper bound on the number of workoutLogs rows a single analytics query
// will pull (each log fans out to its exercise_sets via the relational
// join). 5000 covers ~14 years of daily training with headroom and keeps
// analytics response memory bounded even when the user supplies no date
// range. When the cap is hit the query log emits a warning so we can
// detect users pushing past the limit and proactively offer pagination.
const MAX_WORKOUT_LOGS_PER_QUERY = 5000;

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
    limit: MAX_WORKOUT_LOGS_PER_QUERY,
  });

  if (logs.length >= MAX_WORKOUT_LOGS_PER_QUERY) {
    logger.warn(
      { userId, limit: MAX_WORKOUT_LOGS_PER_QUERY, from: filters?.from, to: filters?.to },
      "queryExerciseSetsWithDates hit row cap — analytics may be truncated; consider narrowing the date range",
    );
  }

  const result: LoggedExerciseSetWithDate[] = [];
  for (const log of logs) {
    for (const set of log.exerciseSets) {
      result.push({ ...set, workoutLogId: log.id, date: log.date });
    }
  }
  return result;
}
