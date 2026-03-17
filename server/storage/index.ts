import type { IStorage } from "./IStorage";
import { UserStorage } from "./users";
import { WorkoutStorage } from "./workouts";
import { PlanStorage } from "./plans";
import { TimelineStorage } from "./timeline";
import { AnalyticsStorage } from "./analytics";

export type { IStorage } from "./IStorage";

class DatabaseStorage {
  private storages: any[];

  constructor() {
    const workoutStorage = new WorkoutStorage();
    this.storages = [
      new UserStorage(),
      workoutStorage,
      new PlanStorage(),
      new TimelineStorage(workoutStorage),
      new AnalyticsStorage()
    ];

    return new Proxy(this, {
      get(target: DatabaseStorage, prop: string | symbol, receiver: any) {
        if (prop in target) {
          return Reflect.get(target, prop, receiver);
        }

        for (const storage of target.storages) {
          if (prop in storage && typeof storage[prop] === 'function') {
            return storage[prop].bind(storage);
          }
        }

        return undefined;
      }
    });
  }
}

export const storage = new DatabaseStorage() as unknown as IStorage;
