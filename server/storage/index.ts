import { AiUsageStorage } from "./aiUsage";
import { AnalyticsStorage } from "./analytics";
import { AnalyticsResultsStorage } from "./analyticsResults";
import { CoachingStorage } from "./coaching";
import { IdempotencyStorage } from "./idempotency";
import type { IStorage } from "./IStorage";
import { MafTestStorage } from "./mafTests";
import { PlanStorage } from "./plans";
import { PushStorage } from "./push";
import { TimelineStorage } from "./timeline";
import { TimelineAnnotationsStorage } from "./timelineAnnotations";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";

export type { IStorage } from "./IStorage";

const workouts = new WorkoutStorage();

export const storage: IStorage = {
  users: new UserStorage(),
  workouts,
  plans: new PlanStorage(),
  timeline: new TimelineStorage(workouts),
  timelineAnnotations: new TimelineAnnotationsStorage(),
  analytics: new AnalyticsStorage(),
  analyticsResults: new AnalyticsResultsStorage(),
  coaching: new CoachingStorage(),
  idempotency: new IdempotencyStorage(),
  aiUsage: new AiUsageStorage(),
  push: new PushStorage(),
  mafTests: new MafTestStorage(),
};
