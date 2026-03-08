import type { Response, NextFunction } from "express";
import { storage } from "./storage";
import type { InsertExerciseSet } from "@shared/schema";
import type { ChatMessage, TrainingContext } from "./gemini";

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

export async function buildTrainingContext(userId: string): Promise<TrainingContext> {
  const timeline = await storage.getTimeline(userId);
  const plans = await storage.listTrainingPlans(userId);

  let completedWorkouts = 0;
  let plannedWorkouts = 0;
  let missedWorkouts = 0;
  let skippedWorkouts = 0;

  const exerciseBreakdown: Record<string, number> = {};
  const recentWorkouts: TrainingContext['recentWorkouts'] = [];
  const completedDates: Set<string> = new Set();

  for (const entry of timeline) {
    if (entry.status === 'completed') {
      completedWorkouts++;
      if (entry.date) completedDates.add(entry.date);
    } else if (entry.status === 'planned') {
      plannedWorkouts++;
    } else if (entry.status === 'missed') {
      missedWorkouts++;
    } else if (entry.status === 'skipped') {
      skippedWorkouts++;
    }

    if (entry.status === 'completed' && entry.focus) {
      const focusLower = entry.focus.toLowerCase();
      const exercises = ['running', 'skierg', 'sled push', 'sled pull', 'burpees', 'rowing', 'farmers carry', 'wall balls', 'lunges'];
      for (const exercise of exercises) {
        if (focusLower.includes(exercise)) {
          exerciseBreakdown[exercise] = (exerciseBreakdown[exercise] || 0) + 1;
        }
      }
      if (!exercises.some(e => focusLower.includes(e))) {
        exerciseBreakdown[entry.focus] = (exerciseBreakdown[entry.focus] || 0) + 1;
      }
    }

    if (entry.status === 'completed' && entry.date) {
      recentWorkouts.push({
        date: entry.date,
        focus: entry.focus || '',
        mainWorkout: entry.mainWorkout || '',
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

  recentWorkouts.sort((a, b) => b.date.localeCompare(a.date));

  const structuredExerciseStats: Record<string, { count: number; maxWeight?: number; maxDistance?: number; bestTime?: number; avgReps?: number }> = {};
  const completedWorkoutLogIds = timeline
    .filter(e => e.status === 'completed' && e.workoutLogId)
    .map(e => e.workoutLogId!);

  if (completedWorkoutLogIds.length > 0) {
    const allSets = await storage.getExerciseSetsByWorkoutLogs(completedWorkoutLogIds);
    for (const es of allSets) {
      if (!structuredExerciseStats[es.exerciseName]) {
        structuredExerciseStats[es.exerciseName] = { count: 0 };
      }
      const stat = structuredExerciseStats[es.exerciseName];
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
  }

  let currentStreak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const sortedDates = Array.from(completedDates).sort().reverse();
  if (sortedDates.length > 0) {
    let checkDate = new Date(today);
    const todayStr = checkDate.toISOString().split('T')[0];
    checkDate.setDate(checkDate.getDate() - 1);
    const yesterdayStr = checkDate.toISOString().split('T')[0];

    if (completedDates.has(todayStr) || completedDates.has(yesterdayStr)) {
      checkDate = completedDates.has(todayStr) ? today : new Date(today.getTime() - 86400000);

      while (true) {
        const dateStr = checkDate.toISOString().split('T')[0];
        if (completedDates.has(dateStr)) {
          currentStreak++;
          checkDate.setDate(checkDate.getDate() - 1);
        } else {
          break;
        }
      }
    }
  }

  const totalWorkouts = completedWorkouts + plannedWorkouts + missedWorkouts + skippedWorkouts;
  const completionRate = (completedWorkouts + missedWorkouts + skippedWorkouts) > 0
    ? Math.round((completedWorkouts / (completedWorkouts + missedWorkouts + skippedWorkouts)) * 100)
    : 0;

  let activePlan: TrainingContext['activePlan'];
  if (plans.length > 0) {
    const plan = plans[0];
    activePlan = {
      name: plan.name,
      totalWeeks: plan.totalWeeks,
    };
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
    structuredExerciseStats: Object.keys(structuredExerciseStats).length > 0 ? structuredExerciseStats : undefined,
    activePlan,
  };
}
