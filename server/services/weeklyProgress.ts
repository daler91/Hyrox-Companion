import { toDateStr } from "../types";

export interface MondayWeekBoundaries {
  thisMondayStr: string;
  lastMondayStr: string;
}

export function getMondayWeekBoundaries(todayInput: Date = new Date()): MondayWeekBoundaries {
  const today = new Date(toDateStr(todayInput));
  const dayOfWeek = today.getDay(); // 0=Sun
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() + mondayOffset);
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);

  return {
    thisMondayStr: toDateStr(thisMonday),
    lastMondayStr: toDateStr(lastMonday),
  };
}
