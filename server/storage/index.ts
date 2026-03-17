import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";

export type { IStorage } from "./IStorage";

function createDatabaseStorage(): IStorage {
  const workoutStorage = new WorkoutStorage();
  const storages = [
    new UserStorage(),
    workoutStorage,
    new PlanStorage(),
    new TimelineStorage(workoutStorage),
    new AnalyticsStorage()
  ];

  return new Proxy({} as IStorage, {
    get(target: IStorage, prop: string | symbol, receiver: unknown) {
      if (prop in target) {
        return Reflect.get(target, prop, receiver);
      }

      for (const storageInstance of storages) {
        if (prop in storageInstance && typeof (storageInstance as any)[prop] === "function") {
          return (storageInstance as any)[prop].bind(storageInstance);
        }
      }

      return undefined;
    }
  });
}

export const storage = createDatabaseStorage();
