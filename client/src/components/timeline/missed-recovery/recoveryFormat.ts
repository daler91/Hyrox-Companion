import type { PlanDayPriority, RecoveryDaySession, RecoveryWeekImpact } from "@shared/schema";
import { differenceInCalendarDays, format, parseISO } from "date-fns";

/**
 * Wording for the missed-session recovery sheet. Pure, so the numbers the
 * athlete reads can be tested without rendering anything.
 */

/** "45 min", "1h 35m", "2h". */
export function formatMinutes(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const rest = rounded % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Today", "Tomorrow", "Thu 25 Sep" — relative to the athlete's own `today`. */
export function formatDayChip(date: string, today: string): string {
  const diff = differenceInCalendarDays(parseISO(date), parseISO(today));
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  return format(parseISO(date), "EEE d MMM");
}

/** "Tuesday 22 Sep" for the sheet's subtitle. */
export function formatLongDay(date: string): string {
  return format(parseISO(date), "EEEE d MMM");
}

/** "This week", "Last week", "Next week", or "Week of 29 Sep". */
export function formatWeekLabel(weekStart: string, today: string): string {
  const monday = parseISO(weekStart);
  const todayDate = parseISO(today);
  const days = differenceInCalendarDays(todayDate, monday);
  if (days >= 0 && days < 7) return "This week";
  if (days >= 7 && days < 14) return "Last week";
  if (days < 0 && days >= -7) return "Next week";
  return `Week of ${format(monday, "d MMM")}`;
}

/** Whether `date` falls in the Monday→Sunday week that starts `weekStart`. */
export function weekContains(weekStart: string, date: string): boolean {
  const days = differenceInCalendarDays(parseISO(date), parseISO(weekStart));
  return days >= 0 && days < 7;
}

/** "+12%", "−24%" (a real minus sign), or "unchanged". */
export function formatLoadChange(week: Pick<RecoveryWeekImpact, "loadBefore" | "loadAfter">): string {
  if (week.loadBefore <= 0) return week.loadAfter > 0 ? "new load" : "unchanged";
  const percent = Math.round(((week.loadAfter - week.loadBefore) / week.loadBefore) * 100);
  if (percent === 0) return "unchanged";
  return percent > 0 ? `+${percent}%` : `−${Math.abs(percent)}%`;
}

export function priorityLabel(priority: PlanDayPriority): string {
  switch (priority) {
    case "key":
      return "Key session";
    case "supporting":
      return "Supporting session";
    case "optional":
      return "Optional session";
  }
}

/** What is already on a candidate day, in a few words. */
export function describeDay(sessions: readonly RecoveryDaySession[]): string {
  if (sessions.length === 0) return "Free";
  const [first] = sessions;
  if (sessions.length > 1 || !first) return `${sessions.length} sessions`;
  return first.status === "completed" ? `${first.focus} (done)` : first.focus;
}

/** How much of the missed session an option keeps, for the impact panel. */
export function describeKept(keptFraction: number, keptMinutes: number, fullMinutes: number): string {
  if (keptFraction >= 1) return `Keeps all of it (${formatMinutes(keptMinutes)})`;
  if (keptFraction <= 0) return `Drops it (${formatMinutes(fullMinutes)})`;
  return `Keeps about ${Math.round(keptFraction * 100)}% (${formatMinutes(keptMinutes)} of ${formatMinutes(fullMinutes)})`;
}
