import type { AiUsageStorage } from "./aiUsage";
import type { AnalyticsStorage } from "./analytics";
import type { AnalyticsResultsStorage } from "./analyticsResults";
import type { CoachingStorage } from "./coaching";
import type { ConsentStorage } from "./consent";
import type { IdempotencyStorage } from "./idempotency";
import type { MafTestStorage } from "./mafTests";
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
  analyticsResults: AnalyticsResultsStorage;
  coaching: CoachingStorage;
  idempotency: IdempotencyStorage;
  aiUsage: AiUsageStorage;
  push: PushStorage;
  mafTests: MafTestStorage;
  consent: ConsentStorage;
}
