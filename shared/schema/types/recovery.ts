import type { PlanDayPriority, PlanDayRecovery } from "../enums";
import { z } from "../zod";
import type { PlanDay } from "./plans";
import { dateStringSchema } from "./requests";

/**
 * Missed-session recovery: the contract behind
 * `GET`/`POST /api/v1/plans/days/:dayId/recovery`.
 *
 * A missed session used to sit on the timeline as a red "Missed" badge with
 * nowhere to go. Recovery offers three ways forward — fold it into another day,
 * shorten it, or let it go — and shows what each does to the plan before the
 * athlete commits. The preview is computed on the server
 * (server/services/missedRecovery) from the same timeline the athlete sees.
 */

/** The ways forward the preview offers. `reopen` undoes a let-go. */
export const missedRecoveryActionEnum = ["fold", "shorten", "let_go", "reopen"] as const;
export type MissedRecoveryAction = (typeof missedRecoveryActionEnum)[number];

/** The three options the preview compares (reopen is not an option, it is an undo). */
export type MissedRecoveryOption = Exclude<MissedRecoveryAction, "reopen">;

export const applyMissedRecoverySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fold"), targetDate: dateStringSchema }).strict(),
  z.object({ action: z.literal("shorten"), targetDate: dateStringSchema }).strict(),
  z.object({ action: z.literal("let_go") }).strict(),
  z.object({ action: z.literal("reopen") }).strict(),
]);
export type ApplyMissedRecoveryBody = z.infer<typeof applyMissedRecoverySchema>;

/** A session already on a candidate day. */
export interface RecoveryDaySession {
  focus: string;
  /** Null for an unplanned (logged, off-plan) session. */
  priority: PlanDayPriority | null;
  durationMin: number;
  status: "planned" | "completed";
}

/**
 * One Monday→Sunday week an option changes, before and after it.
 *
 * "Before" is the week as it stands with the missed session counted where it
 * was scheduled — the plan as written. Sessions that are not going to happen
 * (skipped, other misses, excused days) are left out of both sides, so the
 * difference is exactly this decision.
 */
export interface RecoveryWeekImpact {
  /** The week's Monday. */
  weekStart: string;
  minutesBefore: number;
  minutesAfter: number;
  /** Training load (duration × intensity, the app's UTSS scale). */
  loadBefore: number;
  loadAfter: number;
  /** Key sessions in the week that are done or still planned. */
  keyBefore: number;
  keyAfter: number;
  /** Key sessions scheduled in the week, whatever became of them. */
  keyScheduled: number;
}

export const recoveryNoteCodes = [
  "stacked_key",
  "back_to_back_key",
  "hard_neighbor",
  "long_day",
  "week_jump",
  "race_close",
  "optional_on_day",
  "blocks_not_trimmed",
  "not_trimmable",
] as const;
export type RecoveryNoteCode = (typeof recoveryNoteCodes)[number];

/** Something the athlete should know about an option: a caution, or a tip. */
export interface RecoveryNote {
  code: RecoveryNoteCode;
  tone: "warning" | "info";
  message: string;
}

/** What one option does to the plan. */
export interface RecoveryImpact {
  /** One plain sentence: what happens. */
  summary: string;
  /** The share of the missed session this puts back on the calendar: 1, about 0.6, or 0. */
  keptFraction: number;
  /** The minutes of it that come back. */
  keptMinutes: number;
  /**
   * The day the session lands on and its training minutes with it added, when
   * the option moves it. What was already there is the target's `sessions`.
   */
  day: { date: string; minutesAfter: number } | null;
  /** Every week whose numbers the option changes, oldest first. */
  weeks: RecoveryWeekImpact[];
  notes: RecoveryNote[];
}

/** A day the session could move to, and what moving it there does. */
export interface RecoveryTarget {
  date: string;
  /** What is already on that day. Empty means a free day. */
  sessions: RecoveryDaySession[];
  impact: RecoveryImpact;
}

/** Fold or shorten: the same choice of days, with different amounts moved. */
export interface RecoveryMoveOption {
  available: boolean;
  /** Why it cannot be used, when it cannot. */
  unavailableReason: string | null;
  /** The best of `targets`, or null when there are none. */
  suggestedDate: string | null;
  /** Candidate days, soonest first. */
  targets: RecoveryTarget[];
}

/** One line of what shortening cuts, e.g. "Interval run: 5 sets → 3". */
export interface RecoveryShortenChange {
  label: string;
  from: string;
  to: string;
}

export interface MissedSessionRecoveryPreview {
  planDayId: string;
  /** Where the session sits now: the date it was missed on. */
  missedDate: string;
  focus: string;
  priority: PlanDayPriority;
  /** The decision already on the day: `let_go`, or a previous fold/shorten. */
  recovery: PlanDayRecovery | null;
  /** The athlete's own calendar date. */
  today: string;
  session: {
    durationMin: number;
    /** No exercise table or saved duration to go on: the minutes are an assumption. */
    estimated: boolean;
    rpe: number;
    /** Key, or hard enough (RPE 7+) that neighbouring hard days matter. */
    hard: boolean;
  };
  recommendation: {
    action: MissedRecoveryOption;
    /** The suggested day for fold/shorten; null for let_go. */
    targetDate: string | null;
    reason: string;
  };
  fold: RecoveryMoveOption;
  shorten: RecoveryMoveOption & {
    /** The shortened session's length. */
    durationMin: number;
    keptFraction: number;
    changes: RecoveryShortenChange[];
  };
  letGo: { impact: RecoveryImpact };
}

export interface ApplyMissedRecoveryResponse {
  day: PlanDay;
}
