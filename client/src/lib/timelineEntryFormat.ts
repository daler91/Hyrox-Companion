import { format, parseISO } from "date-fns";

/**
 * Formats a TimelineEntry's `date` string (yyyy-MM-dd) for display in
 * the workout-detail surfaces. Falls back to the raw string if parsing
 * fails so we never crash a sheet on a malformed date.
 */
export function formatScheduledDate(date: string): string {
  try {
    return format(parseISO(date), "EEEE, MMM d");
  } catch {
    return date;
  }
}
