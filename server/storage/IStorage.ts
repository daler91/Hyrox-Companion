import type { UserStorage } from "./users";
import type { WorkoutStorage } from "./workouts";
import type { PlanStorage } from "./plans";
import type { TimelineStorage } from "./timeline";
import type { AnalyticsStorage } from "./analytics";
import type { CoachingStorage } from "./coaching";
import type { IdempotencyStorage } from "./idempotency";

/**
 * Composed storage facade. Callers access domain classes directly:
 *   storage.users.getUser(...)
 *   storage.workouts.createWorkoutLog(...)
 *   storage.plans.getActivePlan(...)
 *   storage.timeline.getTimeline(...)
 *   storage.analytics.getWeeklyStats(...)
 *   storage.coaching.listCoachingMaterials(...)
 */
export interface IStorage {
  users: UserStorage;
  workouts: WorkoutStorage;
  plans: PlanStorage;
  timeline: TimelineStorage;
  analytics: AnalyticsStorage;
  coaching: CoachingStorage;
  idempotency: IdempotencyStorage;
}
