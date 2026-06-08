import { toDateStr } from "../types";

export interface MondayWeekBoundaries {
  thisMondayStr: string;
  lastMondayStr: string;
}

export function getMondayWeekBoundaries(todayInput: Date = new Date()): MondayWeekBoundaries {
  // toDateStr(todayInput) returns "YYYY-MM-DD" in UTC
  const dateStr = toDateStr(todayInput);

  // Parse it explicitly as a UTC date to prevent local timezone skew
  // new Date(dateStr) automatically parses "YYYY-MM-DD" as UTC midnight,
  // but subsequent Date methods like getDay(), getDate() will use the local timezone.
  // Using getUTCDay(), getUTCDate() ensures we stay in UTC.
  const today = new Date(dateStr);

  const dayOfWeek = today.getUTCDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(today);
  thisMonday.setUTCDate(today.getUTCDate() + mondayOffset);

  const lastMonday = new Date(thisMonday);
  lastMonday.setUTCDate(thisMonday.getUTCDate() - 7);

  return {
    thisMondayStr: toDateStr(thisMonday),
    lastMondayStr: toDateStr(lastMonday),
  };
}
