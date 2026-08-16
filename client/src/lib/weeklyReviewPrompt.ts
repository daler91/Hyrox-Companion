import { toISODateString } from "./dateUtils";
import { addDays, mondayOf } from "./weekDates";

/**
 * When the Timeline offers the weekly review, and for which week.
 *
 * The window is Sunday evening through Tuesday: the review is a ritual for the
 * end of a training week, and a prompt that stands all week is wallpaper.
 *
 * The week it points at is always "the week you just trained", which means it
 * changes hands at midnight on Sunday. On Sunday evening that is the week
 * closing tonight; from Monday it is the week that closed. Both resolve to the
 * SAME Monday, which is what makes one dismissal hold for the whole window —
 * dismiss on Sunday and it stays dismissed through Tuesday, then returns for
 * the next week without any extra bookkeeping.
 */

const SUNDAY_EVENING_HOUR = 17;

export interface WeeklyReviewPromptState {
  /** Monday of the week the prompt points at. */
  readonly weekStart: string;
  /** True on Sunday evening, when the week is closing rather than closed. */
  readonly isWrappingUp: boolean;
}

/**
 * `null` outside the window. Every value derives from `now` — including the
 * week, which must not fall back to the ambient clock or the prompt would
 * offer one week's review while claiming to be triggered by another.
 */
export function getWeeklyReviewPrompt(now: Date = new Date()): WeeklyReviewPromptState | null {
  const dayOfWeek = now.getDay(); // 0 = Sunday, local
  const today = toISODateString(now);

  if (dayOfWeek === 0) {
    if (now.getHours() < SUNDAY_EVENING_HOUR) return null;
    // The week closing tonight — its Monday is this week's Monday.
    return { weekStart: mondayOf(today), isWrappingUp: true };
  }

  if (dayOfWeek === 1 || dayOfWeek === 2) {
    return { weekStart: mondayOf(addDays(today, -7)), isWrappingUp: false };
  }

  return null;
}

const DISMISS_KEY_PREFIX = "fitai-weekly-review-prompt-dismissed";

function dismissKey(userId: string): string {
  return `${DISMISS_KEY_PREFIX}:${userId}`;
}

/**
 * Storage can be denied (Safari private mode, a locked-down browser). A prompt
 * that cannot remember a dismissal is a nuisance; one that throws on render is
 * a broken page — so every access degrades to "not dismissed" rather than
 * propagating.
 */
export function isPromptDismissed(userId: string, weekStart: string): boolean {
  try {
    return globalThis.localStorage?.getItem(dismissKey(userId)) === weekStart;
  } catch {
    return false;
  }
}

export function dismissPrompt(userId: string, weekStart: string): void {
  try {
    globalThis.localStorage?.setItem(dismissKey(userId), weekStart);
  } catch {
    // Nothing to do — the prompt reappears next load, which is the safe failure.
  }
}
