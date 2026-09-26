import { type AbsenceRange, isDateExcused } from "@shared/absence";
import {
  addDaysToISODate,
  dayDiff,
  PLAN_WEEKDAYS,
  planWeekOneMonday,
  weekdayIndex,
} from "@shared/dateUtils";
import { formatSessionLength, RECOVERABLE_WITHIN_DAYS, RECOVERY_WINDOW_DAYS } from "@shared/missedRecovery";
import type {
  MissedRecoveryOption,
  MissedSessionRecoveryPreview,
  PlanDayPriority,
  PlanDayRecovery,
  RecoveryDaySession,
  RecoveryImpact,
  RecoveryMoveOption,
  RecoveryNote,
  RecoveryNoteCode,
  RecoveryShortenChange,
  RecoveryTarget,
  RecoveryWeekImpact,
} from "@shared/schema";

/**
 * The missed-session recovery planner: given a missed session and the
 * sessions around it, what folding it into another day, shortening it, or
 * letting it go would each do to the plan — and which of the three a coach
 * would pick.
 *
 * Pure: every input arrives as data (see ./index.ts for the loader), so the
 * whole decision can be read and tested without a database. The numbers are
 * the app's existing scales: minutes, and load on the UTSS scale the planned-
 * session estimate already uses (shared/plannedSessionEstimate.ts).
 */

/** A session at or above this RPE makes a hard day even when it is not key. */
const HARD_RPE = 7;
/** Doubling up past this many minutes in a day earns a caution. */
const LONG_DAY_MIN = 120;
/** Moving a session into another week that grows it by more than this share earns a caution. */
const WEEK_JUMP = 0.1;
/** Hard work this close before race day earns a caution. */
const RACE_TAPER_DAYS = 3;

/** What became of a session around the missed one, for the week's numbers. */
export type PlannerSessionState = "done" | "planned" | "not_happening";

export interface PlannerSession {
  readonly date: string;
  readonly focus: string;
  /** Null for an unplanned (logged, off-plan) session. */
  readonly priority: PlanDayPriority | null;
  /** `not_happening`: skipped, missed, or excused — counted in no week's minutes. */
  readonly state: PlannerSessionState;
  readonly durationMin: number;
  readonly rpe: number;
}

export interface PlannerMissedSession {
  readonly planDayId: string;
  readonly date: string;
  readonly focus: string;
  readonly priority: PlanDayPriority;
  readonly recovery: PlanDayRecovery | null;
  readonly durationMin: number;
  /** The minutes are an assumption (no exercise table and no saved duration). */
  readonly estimated: boolean;
  readonly rpe: number;
  /**
   * A race-week day (race, shakeout, post-race recovery) whose session is
   * derived from its date: moved anywhere else it would turn back into the
   * workout underneath, so it can only be let go.
   */
  readonly fixedToDate: boolean;
  /** The shortened version (./shorten.ts), already estimated. */
  readonly shortened: {
    readonly durationMin: number;
    readonly keptFraction: number;
    readonly changes: readonly RecoveryShortenChange[];
    readonly notes: readonly RecoveryNote[];
  };
}

export interface PlannerInput {
  /** The athlete's own calendar date. */
  readonly today: string;
  readonly missed: PlannerMissedSession;
  /**
   * Every other session from the Monday of the missed session's week through
   * the Sunday after the last candidate day. The missed session is not in it.
   */
  readonly sessions: readonly PlannerSession[];
  /** Declared absences: nothing is moved into one. */
  readonly absences: readonly AbsenceRange[];
  /** The last date a session may move to (the plan's end, or the day before it was retired). */
  readonly lastDate: string | null;
  readonly raceDate: string | null;
}

// ---------------------------------------------------------------------------
// Scales and labels
// ---------------------------------------------------------------------------

/** Load on the app's UTSS scale: duration × (0.6 + (RPE/10)² × 2), as estimatePlannedDayUtss. */
export function sessionLoad(durationMin: number, rpe: number): number {
  return durationMin * (0.6 + Math.pow(rpe / 10, 2) * 2);
}

/** The Monday of `date`'s week (the plan's weeks, and the weekly review's, run Monday to Sunday). */
export function weekOf(date: string): string {
  return planWeekOneMonday(date);
}

function isHard(priority: PlanDayPriority | null, rpe: number): boolean {
  return priority === "key" || rpe >= HARD_RPE;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Tue 22 Sep": a date that still reads right next week, unlike "Tuesday". */
export function shortDate(date: string): string {
  const [, month = "1", day = "1"] = date.split("-");
  const weekday = PLAN_WEEKDAYS[weekdayIndex(date)]?.slice(0, 3) ?? "";
  return `${weekday} ${Number(day)} ${MONTHS[Number(month) - 1] ?? ""}`;
}

/** "today", "tomorrow", "Thursday", "last Friday" or "Mon 6 Oct", relative to `today`. */
export function dayLabel(date: string, today: string): string {
  const diff = dayDiff(today, date);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  const weekday = PLAN_WEEKDAYS[weekdayIndex(date)] ?? date;
  if (diff > 1 && diff < 7) return weekday;
  if (diff < -1 && diff > -7) return weekOf(date) === weekOf(today) ? weekday : `last ${weekday}`;
  return shortDate(date);
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

function listFocuses(sessions: readonly PlannerSession[]): string {
  const names = sessions.map((session) => session.focus || "a session");
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function warning(code: RecoveryNoteCode, message: string): RecoveryNote {
  return { code, tone: "warning", message };
}

function info(code: RecoveryNoteCode, message: string): RecoveryNote {
  return { code, tone: "info", message };
}

// ---------------------------------------------------------------------------
// Week numbers
// ---------------------------------------------------------------------------

interface Move {
  readonly date: string;
  readonly minutes: number;
  readonly rpe: number;
  readonly key: boolean;
}

/**
 * One week before and after an option. "Before" is the plan as written — the
 * missed session counted where it was scheduled; sessions that are not going
 * to happen are left out of both sides, so the difference is exactly this one
 * decision. `move` is where the option puts the session, or null to let it go.
 */
export function weekImpact(input: PlannerInput, weekStart: string, move: Move | null): RecoveryWeekImpact {
  const { live, keyScheduled } = weekSessions(input, weekStart);
  const { missed } = input;
  const missedHere = weekOf(missed.date) === weekStart;
  const moveHere = move !== null && weekOf(move.date) === weekStart;
  const before = contribution(missedHere, missed.durationMin, missed.rpe, missed.priority === "key");
  const after = move ? contribution(moveHere, move.minutes, move.rpe, move.key) : NOTHING;
  // A key session moved in from another week counts among this week's scheduled
  // ones too, so "after" never reads as more key sessions than there are.
  const movedInKey = missedHere ? 0 : after.key;

  return {
    weekStart,
    minutesBefore: Math.round(live.minutes + before.minutes),
    minutesAfter: Math.round(live.minutes + after.minutes),
    loadBefore: Math.round(live.load + before.load),
    loadAfter: Math.round(live.load + after.load),
    keyBefore: live.key + before.key,
    keyAfter: live.key + after.key,
    keyScheduled: keyScheduled + before.key + movedInKey,
  };
}

interface WeekTotals {
  readonly minutes: number;
  readonly load: number;
  readonly key: number;
}

const NOTHING: WeekTotals = { minutes: 0, load: 0, key: 0 };

/** One session's share of a week, or nothing when it isn't in that week. */
function contribution(inWeek: boolean, minutes: number, rpe: number, key: boolean): WeekTotals {
  if (!inWeek) return NOTHING;
  return { minutes, load: sessionLoad(minutes, rpe), key: key ? 1 : 0 };
}

/**
 * The week's other sessions: the ones still happening (done or planned), and
 * how many key sessions the week was planned with, whatever became of them.
 */
function weekSessions(input: PlannerInput, weekStart: string): { live: WeekTotals; keyScheduled: number } {
  const weekEnd = addDaysToISODate(weekStart, 6);
  const inWeek = input.sessions.filter((session) => session.date >= weekStart && session.date <= weekEnd);
  const live = inWeek.filter((session) => session.state !== "not_happening");
  return {
    live: {
      minutes: live.reduce((sum, session) => sum + session.durationMin, 0),
      load: live.reduce((sum, session) => sum + sessionLoad(session.durationMin, session.rpe), 0),
      key: live.filter((session) => session.priority === "key").length,
    },
    keyScheduled: inWeek.filter((session) => session.priority === "key").length,
  };
}

function affectedWeeks(input: PlannerInput, move: Move | null): RecoveryWeekImpact[] {
  const starts = new Set([weekOf(input.missed.date)]);
  if (move) starts.add(weekOf(move.date));
  return [...starts].sort((a, b) => a.localeCompare(b)).map((start) => weekImpact(input, start, move));
}

// ---------------------------------------------------------------------------
// Candidate days and what moving there does
// ---------------------------------------------------------------------------

function liveSessionsOn(input: PlannerInput, date: string): PlannerSession[] {
  return input.sessions.filter((session) => session.date === date && session.state !== "not_happening");
}

function toDaySession(session: PlannerSession): RecoveryDaySession {
  return {
    focus: session.focus,
    priority: session.priority,
    durationMin: Math.round(session.durationMin),
    status: session.state === "done" ? "completed" : "planned",
  };
}

/** Today and the next days, inside the plan, clear of absences and of race day. */
export function candidateDates(input: PlannerInput): string[] {
  const dates: string[] = [];
  for (let offset = 0; offset < RECOVERY_WINDOW_DAYS; offset++) {
    const date = addDaysToISODate(input.today, offset);
    if (input.lastDate !== null && date > input.lastDate) break;
    // Training never moves onto race day or past it.
    if (input.raceDate !== null && date >= input.raceDate) break;
    if (isDateExcused(date, input.absences)) continue;
    dates.push(date);
  }
  return dates;
}

/** Why the session can only be let go, or null when it can move. */
function unmovableReason(input: PlannerInput, candidates: readonly string[]): string | null {
  if (input.missed.fixedToDate) {
    return "Race-week sessions are set around race day, so this one can't move.";
  }
  if (dayDiff(input.missed.date, input.today) > RECOVERABLE_WITHIN_DAYS) {
    return "It was missed more than a week ago — the plan has moved on.";
  }
  if (candidates.length === 0) {
    return "There are no days left in the plan to move it to.";
  }
  return null;
}

function neighbourNote(input: PlannerInput, date: string, move: Move): RecoveryNote | null {
  const moveIsHard = isHard(input.missed.priority, move.rpe);
  if (!moveIsHard) return null;
  const around = [addDaysToISODate(date, -1), addDaysToISODate(date, 1)].flatMap((day) =>
    liveSessionsOn(input, day),
  );
  if (move.key) {
    const key = around.find((session) => session.priority === "key");
    if (key) {
      return warning(
        "back_to_back_key",
        `It sits next to ${dayLabel(key.date, input.today)}'s ${key.focus} — two key sessions back to back.`,
      );
    }
  }
  const hard = around.find((session) => isHard(session.priority, session.rpe));
  if (!hard) return null;
  return warning(
    "hard_neighbor",
    `Back-to-back hard days with ${dayLabel(hard.date, input.today)}'s ${hard.focus}.`,
  );
}

function stackedKeyNote(label: string, onDay: readonly PlannerSession[], move: Move): RecoveryNote | null {
  const otherKey = move.key ? onDay.find((session) => session.priority === "key") : undefined;
  if (!otherKey) return null;
  return warning("stacked_key", `${capitalise(label)} already has a key session, ${otherKey.focus} — two in one day is a lot.`);
}

function longDayNote(label: string, onDay: readonly PlannerSession[], move: Move): RecoveryNote | null {
  const dayMinutes = onDay.reduce((sum, session) => sum + session.durationMin, 0) + move.minutes;
  if (onDay.length === 0 || dayMinutes <= LONG_DAY_MIN) return null;
  return warning("long_day", `${capitalise(label)} becomes about ${formatSessionLength(dayMinutes)} of training.`);
}

function raceCloseNote(input: PlannerInput, date: string, move: Move): RecoveryNote | null {
  if (input.raceDate === null || !isHard(input.missed.priority, move.rpe)) return null;
  const daysToRace = dayDiff(date, input.raceDate);
  if (daysToRace <= 0 || daysToRace > RACE_TAPER_DAYS) return null;
  return warning(
    "race_close",
    daysToRace === 1
      ? "It's the day before race day — keep the legs fresh."
      : `It's ${daysToRace} days before race day — keep the legs fresh.`,
  );
}

/** A week other than the missed one that the move makes noticeably heavier. */
function weekJumpNotes(input: PlannerInput, weeks: readonly RecoveryWeekImpact[]): RecoveryNote[] {
  const missedWeek = weekOf(input.missed.date);
  return weeks.flatMap((week) => {
    if (week.weekStart === missedWeek || week.loadBefore <= 0) return [];
    const growth = (week.loadAfter - week.loadBefore) / week.loadBefore;
    if (growth <= WEEK_JUMP) return [];
    return [
      warning("week_jump", `It adds ${Math.round(growth * 100)}% to the load of the week of ${shortDate(week.weekStart)}.`),
    ];
  });
}

function optionalOnDayNote(label: string, onDay: readonly PlannerSession[]): RecoveryNote | null {
  const optional = onDay.find((session) => session.priority === "optional" && session.state === "planned");
  if (!optional) return null;
  return info("optional_on_day", `${capitalise(label)}'s ${optional.focus} is optional — drop it if the day feels full.`);
}

function isNote(note: RecoveryNote | null): note is RecoveryNote {
  return note !== null;
}

/** The cautions for moving the session onto `date`, then the tips. */
function moveNotes(
  input: PlannerInput,
  date: string,
  onDay: readonly PlannerSession[],
  move: Move,
  weeks: readonly RecoveryWeekImpact[],
): RecoveryNote[] {
  const label = dayLabel(date, input.today);
  return [
    stackedKeyNote(label, onDay, move),
    neighbourNote(input, date, move),
    longDayNote(label, onDay, move),
    raceCloseNote(input, date, move),
    ...weekJumpNotes(input, weeks),
    optionalOnDayNote(label, onDay),
  ].filter(isNote);
}

function moveSummary(
  input: PlannerInput,
  option: "fold" | "shorten",
  date: string,
  onDay: readonly PlannerSession[],
  minutes: number,
): string {
  const { missed } = input;
  const label = dayLabel(date, input.today);
  const total = onDay.reduce((sum, session) => sum + session.durationMin, 0) + minutes;
  const what =
    option === "fold"
      ? `the full ${missed.focus} (${formatSessionLength(minutes)})`
      : `a ${formatSessionLength(minutes)} version of ${missed.focus} (instead of ${formatSessionLength(missed.durationMin)})`;
  if (onDay.length === 0) return `${capitalise(label)} gets ${what}.`;
  return `${capitalise(label)} gets ${what} alongside ${listFocuses(onDay)} — about ${formatSessionLength(total)} in all.`;
}

function buildTarget(
  input: PlannerInput,
  option: "fold" | "shorten",
  date: string,
): RecoveryTarget {
  const { missed } = input;
  const minutes = option === "fold" ? missed.durationMin : missed.shortened.durationMin;
  const move: Move = { date, minutes, rpe: missed.rpe, key: missed.priority === "key" };
  const onDay = liveSessionsOn(input, date);
  const weeks = affectedWeeks(input, move);
  const notes = moveNotes(input, date, onDay, move, weeks);
  if (option === "shorten") notes.push(...missed.shortened.notes);
  return {
    date,
    sessions: onDay.map(toDaySession),
    impact: {
      summary: moveSummary(input, option, date, onDay, minutes),
      keptFraction: option === "fold" ? 1 : missed.shortened.keptFraction,
      keptMinutes: Math.round(minutes),
      day: {
        date,
        minutesAfter: Math.round(onDay.reduce((sum, session) => sum + session.durationMin, 0) + minutes),
      },
      weeks,
      notes,
    },
  };
}

// ---------------------------------------------------------------------------
// Choosing
// ---------------------------------------------------------------------------

/** How much each caution counts against a day. Tips cost nothing. */
const NOTE_WEIGHT: Readonly<Record<RecoveryNoteCode, number>> = {
  race_close: 6,
  stacked_key: 4,
  back_to_back_key: 3,
  hard_neighbor: 2,
  long_day: 2,
  week_jump: 1.5,
  optional_on_day: 0,
  blocks_not_trimmed: 0,
  not_trimmable: 0,
};

/** Cautions a recommendation never walks into. */
const SEVERE: ReadonlySet<RecoveryNoteCode> = new Set(["race_close", "stacked_key", "back_to_back_key"]);

function sessionWeight(priority: PlanDayPriority | null): number {
  if (priority === "key") return 3;
  if (priority === "optional") return 0.5;
  return 1.5;
}

/**
 * Lower is better: sooner, in the same week, on a lighter day, with fewer
 * cautions. Staying in the missed session's week keeps the week's shape; a
 * free day beats doubling up; an optional session is the cheapest company.
 */
function targetScore(input: PlannerInput, target: RecoveryTarget): number {
  let score = dayDiff(input.today, target.date) * 0.3;
  if (weekOf(target.date) !== weekOf(input.missed.date)) score += 1.5;
  for (const session of target.sessions) score += sessionWeight(session.priority);
  for (const note of target.impact.notes) score += NOTE_WEIGHT[note.code];
  return score;
}

function isClean(target: RecoveryTarget): boolean {
  return target.impact.notes.every((note) => note.tone !== "warning");
}

function isTolerable(target: RecoveryTarget): boolean {
  return target.impact.notes.every((note) => !SEVERE.has(note.code));
}

function bestTarget(
  input: PlannerInput,
  targets: readonly RecoveryTarget[],
  accept: (target: RecoveryTarget) => boolean = () => true,
): RecoveryTarget | undefined {
  let best: RecoveryTarget | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const target of targets) {
    if (!accept(target)) continue;
    const score = targetScore(input, target);
    if (score < bestScore) {
      best = target;
      bestScore = score;
    }
  }
  return best;
}

/**
 * The day an option suggests on its own: one with no cautions when there is
 * one, then one with no severe caution, then the least bad. The recommended
 * option suggests the recommendation's day instead (see
 * planMissedSessionRecovery), so the sheet never marks one day "best fit"
 * while recommending another.
 */
function suggestTarget(input: PlannerInput, targets: readonly RecoveryTarget[]): RecoveryTarget | undefined {
  return (
    bestTarget(input, targets, isClean) ??
    bestTarget(input, targets, isTolerable) ??
    bestTarget(input, targets)
  );
}

function moveOption(
  input: PlannerInput,
  option: "fold" | "shorten",
  candidates: readonly string[],
  unavailableReason: string | null,
): RecoveryMoveOption {
  if (unavailableReason !== null) {
    return { available: false, unavailableReason, suggestedDate: null, targets: [] };
  }
  const targets = candidates.map((date) => buildTarget(input, option, date));
  return {
    available: true,
    unavailableReason: null,
    suggestedDate: suggestTarget(input, targets)?.date ?? null,
    targets,
  };
}

interface Recommendation {
  readonly action: MissedRecoveryOption;
  readonly targetDate: string | null;
  readonly reason: string;
}

function letGo(reason: string): Recommendation {
  return { action: "let_go", targetDate: null, reason };
}

function recommend(input: PlannerInput, fold: RecoveryMoveOption, shorten: RecoveryMoveOption): Recommendation {
  const { missed, today } = input;
  if (!fold.available) return letGo(fold.unavailableReason ?? "It can't be moved.");

  const at = (target: RecoveryTarget) => dayLabel(target.date, today);
  const sameWeek = (target: RecoveryTarget) => weekOf(target.date) === weekOf(missed.date);
  const cleanFold = bestTarget(input, fold.targets, isClean);
  const cleanShorten = bestTarget(input, shorten.targets, isClean);
  const tolerableShorten = bestTarget(input, shorten.targets, isTolerable);

  if (missed.recovery === "folded" || missed.recovery === "shortened") {
    const shortenAt = tolerableShorten;
    if (missed.priority === "key" && shortenAt) {
      return {
        action: "shorten",
        targetDate: shortenAt.date,
        reason: `It has already been moved once, but it's a key session — a shorter version ${at(shortenAt)} is still worth doing.`,
      };
    }
    return letGo("It has already been moved once — chasing it again usually costs more than it gives.");
  }

  if (missed.priority === "optional") {
    return letGo("It's an optional session — the plan doesn't need it back.");
  }

  if (missed.priority === "key") {
    if (cleanFold) {
      return { action: "fold", targetDate: cleanFold.date, reason: `A key session, and ${at(cleanFold)} has room for all of it.` };
    }
    if (tolerableShorten) {
      return {
        action: "shorten",
        targetDate: tolerableShorten.date,
        reason: `A key session, but the full version would crowd the week — a shorter one ${at(tolerableShorten)} keeps most of the benefit.`,
      };
    }
    return letGo("Every day that's left would stack it on top of hard work — letting it go is the safer call.");
  }

  // Supporting: worth the full session only without disturbing another week.
  const cleanFoldThisWeek = bestTarget(input, fold.targets, (target) => isClean(target) && sameWeek(target));
  if (cleanFoldThisWeek) {
    return {
      action: "fold",
      targetDate: cleanFoldThisWeek.date,
      reason: `${capitalise(at(cleanFoldThisWeek))} has room for it, and the week stays as planned.`,
    };
  }
  if (cleanShorten) {
    return {
      action: "shorten",
      targetDate: cleanShorten.date,
      reason: `A shorter version fits ${at(cleanShorten)} without crowding the week.`,
    };
  }
  return letGo("There's no clean slot for it, and a supporting session costs little to let go.");
}

function letGoImpact(input: PlannerInput): RecoveryImpact {
  return {
    summary: `${capitalise(input.missed.focus || "The session")} stays missed, and the rest of the plan carries on as it is.`,
    keptFraction: 0,
    keptMinutes: 0,
    day: null,
    weeks: affectedWeeks(input, null),
    notes: [],
  };
}

/** The option with the recommendation's day as its best fit, when it is the one recommended. */
function withRecommendedDay(
  option: RecoveryMoveOption,
  action: "fold" | "shorten",
  recommendation: Recommendation,
): RecoveryMoveOption {
  if (recommendation.action !== action || recommendation.targetDate === null) return option;
  return { ...option, suggestedDate: recommendation.targetDate };
}

export function planMissedSessionRecovery(input: PlannerInput): MissedSessionRecoveryPreview {
  const { missed } = input;
  const candidates = candidateDates(input);
  const reason = unmovableReason(input, candidates);
  const foldOption = moveOption(input, "fold", candidates, reason);
  const shortenOption = moveOption(input, "shorten", candidates, reason);
  const recommendation = recommend(input, foldOption, shortenOption);
  const fold = withRecommendedDay(foldOption, "fold", recommendation);
  const shorten = withRecommendedDay(shortenOption, "shorten", recommendation);

  return {
    planDayId: missed.planDayId,
    missedDate: missed.date,
    focus: missed.focus,
    priority: missed.priority,
    recovery: missed.recovery,
    today: input.today,
    session: {
      durationMin: Math.round(missed.durationMin),
      estimated: missed.estimated,
      rpe: missed.rpe,
      hard: isHard(missed.priority, missed.rpe),
    },
    recommendation,
    fold,
    shorten: {
      ...shorten,
      durationMin: Math.round(missed.shortened.durationMin),
      keptFraction: missed.shortened.keptFraction,
      changes: [...missed.shortened.changes],
    },
    letGo: { impact: letGoImpact(input) },
  };
}
