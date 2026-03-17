import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";

export type { IStorage } from "./IStorage";

type AssertAllKeys<T, U extends Record<keyof T, unknown>> = U;

type DelegateUnion = UserStorage & WorkoutStorage & PlanStorage & TimelineStorage & AnalyticsStorage;

type _CheckCoverage = AssertAllKeys<IStorage, DelegateUnion>;

function createDatabaseStorage(): IStorage {
  const userStorage = new UserStorage();
  const workoutStorage = new WorkoutStorage();
  const planStorage = new PlanStorage();
  const timelineStorage = new TimelineStorage(workoutStorage);
  const analyticsStorage = new AnalyticsStorage();

  const delegates = [
    userStorage,
    workoutStorage,
    planStorage,
    timelineStorage,
    analyticsStorage,
  ];

  return new Proxy({} as IStorage, {
    get(_target, prop, receiver) {
      for (const delegate of delegates) {
        const value = (delegate as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof value === "function") {
          return value.bind(delegate);
        }
      }
      return Reflect.get(_target, prop, receiver);
    },
  });
}

export const storage = createDatabaseStorage();
