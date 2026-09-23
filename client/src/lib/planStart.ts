import {
  describeWeekdaySpan,
  nextPlanStartDate,
  PLAN_WEEKDAYS,
  weekdayIndex,
  weekOneDaysBeforeStart,
} from "@shared/dateUtils";

import { getTodayString } from "@/lib/dateUtils";

/**
 * The start date every plan picker offers first: the next Monday, or today
 * when today is one. A Monday start keeps all of week 1 on the calendar; the
 * pickers used to default to tomorrow, today, or this week's (past) Monday,
 * and the plan opened with missed sessions (onboarding audit C3).
 */
export function defaultPlanStartDate(): string {
  return nextPlanStartDate(getTodayString());
}

/**
 * What a start date does to week 1 of a template or imported plan. Week 1
 * runs Monday to Sunday and no session is placed before the start date, so a
 * midweek start leaves week 1's earlier sessions off the calendar. Null for a
 * Monday, which loses nothing.
 */
export function weekOneStartNote(startDate: string): string | null {
  const before = weekOneDaysBeforeStart(startDate);
  if (before.length === 0) return null;
  const weekday = PLAN_WEEKDAYS[weekdayIndex(startDate)];
  return `Plans run Monday to Sunday, so starting on a ${weekday} leaves week 1's ${describeWeekdaySpan(before)} sessions off your calendar. Pick a Monday to keep them.`;
}

/**
 * The same note for an AI plan, which is told about a midweek start and
 * plans those days as rest instead of losing sessions to them.
 */
export function aiWeekOneStartNote(startDate: string): string | null {
  const before = weekOneDaysBeforeStart(startDate);
  if (before.length === 0) return null;
  const weekday = PLAN_WEEKDAYS[weekdayIndex(startDate)];
  return `Week 1 starts on a ${weekday}, so the plan keeps ${describeWeekdaySpan(before)} of that week as rest.`;
}
