/**
 * The background-Strava kill switch, on its own so read paths (session
 * grading, reached from the weekly review and the email scheduler) can ask
 * about it without importing the queue module — which imports the email
 * scheduler, and would close an import cycle through it.
 */
import { env } from "../env";

/** Master kill switch: STRAVA_AUTO_SYNC_ENABLED=false leaves only the manual Sync button. */
export function isStravaAutoSyncEnabled(): boolean {
  return env.STRAVA_AUTO_SYNC_ENABLED !== "false";
}
