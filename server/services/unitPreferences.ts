import { users } from "@shared/schema";
import type { UnitPreferences } from "@shared/unitConversion";
import { eq } from "drizzle-orm";

import { db, type DbExecutor } from "../db";

/**
 * The athlete's display units, for write paths that must record what unit an
 * incoming number is in (audit L4).
 *
 * Every `exercise_sets` insert now stamps the unit its numbers arrived in. Most
 * write paths already carry the athlete's preferences; the few that only carry
 * a `userId` use this rather than each growing its own `getUser` call and its
 * own idea of what to do when the row is missing.
 *
 * A missing user falls back to the schema defaults (kg / km) — the same values
 * `users.weight_unit` and `users.distance_unit` default to, so a row written
 * through this path is stamped with the unit it would have been written in
 * anyway. It cannot silently mean something else.
 *
 * A caller inside a transaction passes it as `executor`, so the read uses the
 * transaction's own connection. Read through the pool instead, each open save
 * held one connection while it waited for a second, and twenty concurrent
 * saves could hold all twenty while each waited for a twenty-first.
 * D49 (CODEBASE_ANALYSIS_2026-10-03)
 */
export async function loadUnitPreferences(
  userId: string,
  executor: DbExecutor = db,
): Promise<UnitPreferences> {
  const [user] = await executor
    .select({ weightUnit: users.weightUnit, distanceUnit: users.distanceUnit })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return { weightUnit: user?.weightUnit ?? "kg", distanceUnit: user?.distanceUnit ?? "km" };
}
