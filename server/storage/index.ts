import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";
import { CoachingStorage } from "./coaching";

export type { IStorage } from "./IStorage";

type AssertAllKeys<T, U extends Record<keyof T, unknown>> = U;

type DelegateUnion = UserStorage & WorkoutStorage & PlanStorage & TimelineStorage & AnalyticsStorage & CoachingStorage;

type _CheckCoverage = AssertAllKeys<IStorage, DelegateUnion>;

function createDatabaseStorage(): IStorage {
  const userStorage = new UserStorage();
  const workoutStorage = new WorkoutStorage();
  const planStorage = new PlanStorage();
  const timelineStorage = new TimelineStorage(workoutStorage);
  const analyticsStorage = new AnalyticsStorage();
  const coachingStorage = new CoachingStorage();

  const delegates = [
    userStorage,
    workoutStorage,
    planStorage,
    timelineStorage,
    analyticsStorage,
    coachingStorage,
  ];

  return new Proxy({} as IStorage, {
    get(_target, prop, receiver) {
      for (const delegate of delegates) {
        const value = (delegate as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof value === "function") {
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- dynamic proxy delegation
          return value.bind(delegate);
        }
      }

      if (typeof prop === "string" && prop !== "then") {
        throw new Error(`Method '${String(prop)}' not implemented in any storage delegate.`);
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- Proxy passthrough
      return Reflect.get(_target, prop, receiver);
    },
  });
}

export const storage = createDatabaseStorage();
