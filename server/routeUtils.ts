import type { Response, NextFunction } from "express";
import { storage } from "./storage";
import type { InsertExerciseSet } from "@shared/schema";
import type { TrainingContext } from "./gemini";
import { toDateStr } from "./types";
import { HYROX_EXERCISES } from "./prompts";

const rateLimitBuckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimiter(category: string, maxRequests: number, windowMs: number = 60000) {
  return (req: any, res: Response, next: NextFunction) => {
    const userId = req.user?.claims?.sub;
    if (!userId) {
      return next();
    }
    const key = `${category}:${userId}`;
    const now = Date.now();
    const bucket = rateLimitBuckets.get(key);

    if (!bucket || now >= bucket.resetAt) {
      rateLimitBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    if (bucket.count >= maxRequests) {
      const retryAfterSec = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({
        error: `Too many requests. Please wait ${retryAfterSec} seconds before trying again.`,
      });
    }

    bucket.count++;
    return next();
  };
}

setInterval(() => {
  const now = Date.now();
  rateLimitBuckets.forEach((bucket, key) => {
    if (now >= bucket.resetAt) {
      rateLimitBuckets.delete(key);
    }
  });
}, 120000);

export function expandExercisesToSetRows(exercises: any[], workoutLogId: string): InsertExerciseSet[] {
  const rows: InsertExerciseSet[] = [];
  let sortOrder = 0;
  for (const ex of exercises) {
    if (ex.sets && Array.isArray(ex.sets)) {
      for (const set of ex.sets) {
        rows.push({
          workoutLogId,
          exerciseName: ex.exerciseName,
          customLabel: ex.customLabel || null,
          category: ex.category,
          setNumber: set.setNumber || 1,
          reps: set.reps ?? null,
          weight: set.weight ?? null,
          distance: set.distance ?? null,
          time: set.time ?? null,
          confidence: ex.confidence ?? null,
          notes: set.notes || null,
          sortOrder: sortOrder++,
        });
      }
    } else {
      const numSets = ex.numSets || 1;
      for (let s = 1; s <= numSets; s++) {
        rows.push({
          workoutLogId,
          exerciseName: ex.exerciseName,
          customLabel: ex.customLabel || null,
          category: ex.category,
          setNumber: s,
          reps: ex.reps ?? null,
          weight: ex.weight ?? null,
          distance: ex.distance ?? null,
          time: ex.time ?? null,
          notes: ex.notes || null,
          sortOrder: sortOrder++,
        });
      }
    }
  }
  return rows;
}

export async function upsertCustomExercisesFromSets(exercises: any[], userId: string): Promise<void> {
  for (const ex of exercises) {
    if (ex.exerciseName === "custom" && ex.customLabel) {
      await storage.upsertCustomExercise({ userId, name: ex.customLabel, category: ex.category || "conditioning" });
    }
  }
}

export async function reparseWorkout(
  workout: { id: string; mainWorkout?: string | null; accessory?: string | null },
  weightUnit: string
): Promise<{ exercises: any[]; setCount: number } | null> {
  const { parseExercisesFromText } = await import("./gemini");
  const { exerciseSets } = await import("@shared/schema");
  const { db } = await import("./db");
  const { eq } = await import("drizzle-orm");

  const textToParse = [workout.mainWorkout, workout.accessory].filter(Boolean).join("\n");
  if (!textToParse.trim()) return null;

  const exercises = await parseExercisesFromText(textToParse.trim(), weightUnit);
  if (exercises.length === 0) return null;

  const setRows = expandExercisesToSetRows(exercises, workout.id);

  await db.transaction(async (tx) => {
    await tx.delete(exerciseSets).where(eq(exerciseSets.workoutLogId, workout.id));
    if (setRows.length > 0) {
      await tx.insert(exerciseSets).values(setRows);
    }
  });

  return { exercises, setCount: setRows.length };
}

interface TimelineEntry {
  status?: string | null;
  date?: string | null;
  focus?: string | null;
  mainWorkout?: string | null;
  workoutLogId?: string | null;
  exerciseSets?: Array<{
    exerciseName: string;
    setNumber?: number | null;
    reps?: number | null;
    weight?: number | null;
    distance?: number | null;
    time?: number | null;
  }> | null;
}

function calculateTrainingStats(timeline: TimelineEntry[]) {
  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;
  const completedDates = new Set<string>();

  for (const entry of timeline) {
    if (entry.status === "completed") {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === "planned") {
      plannedWorkouts++;
    } else if (entry.status === "missed") {
      missedWorkouts++;
    } else if (entry.status === "skipped") {
      skippedWorkouts++;
    }
  }

  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts;
  const denominator = completedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = denominator > 0 ? Math.round((completedWorkouts / denominator) * 100) : 0;

  return { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates };
}

function getExerciseBreakdown(timeline: TimelineEntry[]): Record<string, number> {
  const breakdown: Record<string, number> = {};
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.focus) {
      const focusLower = entry.focus.toLowerCase();
      let matched = false;
      for (const exercise of HYROX_EXERCISES) {
        if (focusLower.includes(exercise)) {
          breakdown[exercise] = (breakdown[exercise] || 0) + 1;
          matched = true;
        }
      }
      if (!matched) {
        breakdown[entry.focus] = (breakdown[entry.focus] || 0) + 1;
      }
    }
  }
  return breakdown;
}

export function calculateStreak(completedDates: Set<string>): number {
  if (completedDates.size === 0) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = toDateStr(today);

  const yesterday = new Date(today.getTime() - 86400000);
  const yesterdayStr = toDateStr(yesterday);

  if (!completedDates.has(todayStr) && !completedDates.has(yesterdayStr)) return 0;

  let streak = 0;
  let checkDate = completedDates.has(todayStr) ? new Date(today) : new Date(yesterday);

  while (true) {
    const dateStr = toDateStr(checkDate);
    if (completedDates.has(dateStr)) {
      streak++;
      checkDate.setDate(checkDate.getDate() - 1);
    } else {
      break;
    }
  }

  return streak;
}

function collectRecentWorkouts(timeline: TimelineEntry[]): TrainingContext["recentWorkouts"] {
  const recent: TrainingContext["recentWorkouts"] = [];
  for (const entry of timeline) {
    if (entry.status === "completed" && entry.date) {
      recent.push({
        date: entry.date,
        focus: entry.focus || "",
        mainWorkout: entry.mainWorkout || "",
        status: entry.status,
        exerciseDetails: entry.exerciseSets?.map(es => ({
          name: es.exerciseName,
          setNumber: es.setNumber,
          reps: es.reps,
          weight: es.weight,
          distance: es.distance,
          time: es.time,
        })),
      });
    }
  }
  recent.sort((a, b) => b.date.localeCompare(a.date));
  return recent;
}

async function getStructuredExerciseStats(timeline: TimelineEntry[]) {
  const completedWorkoutLogIds = timeline
    .filter(e => e.status === "completed" && e.workoutLogId)
    .map(e => e.workoutLogId!);

  const stats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};

  if (completedWorkoutLogIds.length === 0) return undefined;

  const allSets = await storage.getExerciseSetsByWorkoutLogs(completedWorkoutLogIds);
  for (const es of allSets) {
    if (!stats[es.exerciseName]) stats[es.exerciseName] = { count: 0 };
    const stat = stats[es.exerciseName];
    stat.count++;
    if (es.weight) {
      if (!stat.maxWeight || es.weight > stat.maxWeight) stat.maxWeight = es.weight;
    }
    if (es.distance) {
      if (!stat.maxDistance || es.distance > stat.maxDistance) stat.maxDistance = es.distance;
    }
    if (es.time) {
      if (!stat.bestTime || es.time < stat.bestTime) stat.bestTime = es.time;
    }
    if (es.reps) {
      stat.avgReps = stat.avgReps
        ? Math.round((stat.avgReps * (stat.count - 1) + es.reps) / stat.count)
        : es.reps;
    }
  }

  return Object.keys(stats).length > 0 ? stats : undefined;
}

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const timeline = await storage.getTimeline(userId);
  const plans = await storage.listTrainingPlans(userId);

  const { completedWorkouts, plannedWorkouts, missedWorkouts, skippedWorkouts, totalWorkouts, completionRate, completedDates } = calculateTrainingStats(timeline);
  const exerciseBreakdown = getExerciseBreakdown(timeline);
  const currentStreak = calculateStreak(completedDates);
  const recentWorkouts = collectRecentWorkouts(timeline);
  const structuredExerciseStats = await getStructuredExerciseStats(timeline);

  let activePlan: TrainingContext["activePlan"];
  if (plans.length > 0) {
    activePlan = { name: plans[0].name, totalWeeks: plans[0].totalWeeks };
  }

  return {
    totalWorkouts,
    completedWorkouts,
    plannedWorkouts,
    missedWorkouts,
    skippedWorkouts,
    completionRate,
    currentStreak,
    recentWorkouts: recentWorkouts.slice(0, 10),
    exerciseBreakdown,
    structuredExerciseStats,
    activePlan,
  };
}
