/**
 * Format a Date as `YYYY-MM-DD` in the **user's local timezone**.
 *
 * NOT UTC — using `Date#toISOString().split("T")[0]` would silently shift
 * the date back/forward for users outside UTC (e.g. a 23:00 PST log would
 * land on tomorrow's date). All timeline / workout / plan-day date strings
 * in this app are local-TZ; mixing UTC strings with these will misalign
 * "today" / "yesterday" comparisons, streak counts, and date-based
 * filters.
 *
 * Use this helper any time you persist or compare a calendar date that
 * the user authored — never the raw `toISOString` slice.
 */
export function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function getTodayString(): string {
  return toISODateString(new Date());
}

export function getStartOfWeek(date: Date = new Date(), weekStartsOn: 0 | 1 = 0): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day < weekStartsOn ? 7 : 0) + day - weekStartsOn;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function getEndOfWeek(date: Date = new Date(), weekStartsOn: 0 | 1 = 0): Date {
  const start = getStartOfWeek(date, weekStartsOn);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
}

export function getStartOfWeekString(date: Date = new Date(), weekStartsOn: 0 | 1 = 0): string {
  return toISODateString(getStartOfWeek(date, weekStartsOn));
}

export function getEndOfWeekString(date: Date = new Date(), weekStartsOn: 0 | 1 = 0): string {
  return toISODateString(getEndOfWeek(date, weekStartsOn));
}

export function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  return dateStr >= startStr && dateStr <= endStr;
}

export function isDateInCurrentWeek(dateStr: string, weekStartsOn: 0 | 1 = 0): boolean {
  const startStr = getStartOfWeekString(new Date(), weekStartsOn);
  const endStr = getEndOfWeekString(new Date(), weekStartsOn);
  return isDateInRange(dateStr, startStr, endStr);
}

export function isDatePast(dateStr: string): boolean {
  return dateStr < getTodayString();
}

export function isDateFuture(dateStr: string): boolean {
  return dateStr > getTodayString();
}

export function isDateToday(dateStr: string): boolean {
  return dateStr === getTodayString();
}

export function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function getCurrentTimeString(): string {
  return formatTime(new Date());
}
