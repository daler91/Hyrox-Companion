import { AppError, ErrorCode } from "../errors";
import { storage } from "../storage";
import { addDaysLocal, getLocalDateStrSafe } from "../timezone";

/**
 * A workout log may be dated no later than the athlete's own tomorrow. The
 * route schema cannot know their timezone, so it lets through tomorrow
 * wherever that is latest (UTC+14) and this holds the date to theirs; it used
 * UTC's, refusing "Move to tomorrow" for a UTC+N athlete until N o'clock.
 * CL70 (CODEBASE_ANALYSIS_2026-10-03)
 *
 * Every write that dates a log goes through it: create, update and the merged
 * log of a combine (which checked the schema only until tech debt #46).
 */
export async function assertWorkoutDateNotFuture(userId: string, date: string | undefined): Promise<void> {
  if (date === undefined) return;
  const user = await storage.users.getUser(userId);
  const tomorrow = addDaysLocal(getLocalDateStrSafe(new Date(), user?.userTimezone), 1);
  if (date > tomorrow) {
    throw new AppError(ErrorCode.VALIDATION_ERROR, "Workout date cannot be in the future", 400);
  }
}
