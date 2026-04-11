import type { AiUsageStorage } from "./aiUsage";
import type { AnalyticsStorage } from "./analytics";
import type { CoachingStorage } from "./coaching";
import type { IdempotencyStorage } from "./idempotency";
import type { PlanStorage } from "./plans";
import type { PushStorage } from "./push";
import type { TimelineStorage } from "./timeline";
import type { TimelineAnnotationsStorage } from "./timelineAnnotations";
import type { UserStorage } from "./users";
import type { WorkoutStorage } from "./workouts";

/**
 * Composed storage facade. Callers access domain classes directly:
 *   storage.users.getUser(...)
 *   storage.workouts.createWorkoutLog(...)
 *   storage.plans.getActivePlan(...)
 *   storage.timeline.getTimeline(...)
 *   storage.timelineAnnotations.list(...)
 *   storage.analytics.getWeeklyStats(...)
 *   storage.coaching.listCoachingMaterials(...)
 *   storage.aiUsage.getDailyTotalCents(...)
 *   storage.push.saveSubscription(...)
 */
export interface IStorage {
  users: UserStorage;
  workouts: WorkoutStorage;
  plans: PlanStorage;
  timeline: TimelineStorage;
  timelineAnnotations: TimelineAnnotationsStorage;
  analytics: AnalyticsStorage;
  coaching: CoachingStorage;
  idempotency: IdempotencyStorage;
  aiUsage: AiUsageStorage;
  push: PushStorage;
}
