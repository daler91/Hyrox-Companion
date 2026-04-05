import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";
import { CoachingStorage } from "./coaching";
import { IdempotencyStorage } from "./idempotency";
import type { IStorage } from "./IStorage";

export type { IStorage } from "./IStorage";

const workouts = new WorkoutStorage();

export const storage: IStorage = {
  users: new UserStorage(),
  workouts,
  plans: new PlanStorage(),
  timeline: new TimelineStorage(workouts),
  analytics: new AnalyticsStorage(),
  coaching: new CoachingStorage(),
  idempotency: new IdempotencyStorage(),
};
