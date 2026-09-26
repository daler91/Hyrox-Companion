// Session grading — "did the session do its job?"
//
// The wire shapes behind GET /api/v1/session-grades, GET
// /api/v1/workouts/:id/session-grade and the grade chips on the Weekly Review.
// Grades are computed on read from the run's stored stream (or, without one,
// its summary metrics), so none of these shapes is persisted.
import type { TrainingPhase } from "../../nutritionTargets";
import type { RunPurpose, SessionGradeIntent } from "../../sessionIntent";
import type { SessionStreamStatus } from "../enums";

/**
 * - `on_target`: the run did what the day was for.
 * - `crept_up`: an easy run that drifted above easy for part of it.
 * - `too_hard`: an easy run that was not easy.
 * - `drifted_harder`: a threshold run that went harder than threshold.
 * - `under`: a threshold run that never reached threshold.
 * - `inconclusive`: the data cannot tell (usually whole-run averages of a threshold session).
 * - `ungradeable`: nothing to grade against or with (see `ungradeableReason`).
 */
export type SessionGradeVerdict =
  | "on_target"
  | "crept_up"
  | "too_hard"
  | "drifted_harder"
  | "under"
  | "inconclusive"
  | "ungradeable";

export type SessionGradeConfidence = "high" | "medium" | "low";
export type SessionGradeDataSource = "stream" | "summary";
/** The stored row's status, or `pending` (not fetched yet) / `not_applicable` (no Strava recording). */
export type SessionStreamState = SessionStreamStatus | "pending" | "not_applicable";
/**
 * - `no_targets`: no max HR or age for zones, and no pace to go on.
 * - `no_data`: the recording has neither usable heart rate nor pace.
 * - `too_short`: too little running to judge.
 */
export type SessionUngradeableReason = "no_targets" | "no_data" | "too_short";

export interface SessionGradeTargets {
  /** Top of Z2 (or the athlete's MAF ceiling), bpm. */
  easyCeilingHr: number | null;
  /** Z4, bpm. */
  thresholdHr: { min: number; max: number } | null;
  /** Bottom of Z5, bpm. */
  z5FloorHr: number | null;
  hrBasis: "measured" | "age_estimated" | "maf" | null;
  /** Seconds per km, fast end first. */
  easyPace: { fast: number; slow: number } | null;
  /** Seconds per km. */
  thresholdPace: number | null;
  /** Where the pace came from: written in the plan, the plan's engine fitness, or recent runs. */
  paceSource: "plan" | "engine" | "history" | null;
}

export interface EasyGradeMetrics {
  movingMinutes: number;
  avgHr: number | null;
  /** Share of moving time above the easy ceiling, 0-100. */
  pctAboveCeiling: number | null;
  firstThirdHr: number | null;
  lastThirdHr: number | null;
  /** Last third vs first third, percent. */
  hrDriftPct: number | null;
  /** Seconds per km. */
  avgPaceSecPerKm: number | null;
  /** Share of moving time faster than easy pace, 0-100. */
  pctFasterThanEasy: number | null;
  /** A long run's harder finish, left out of the grade. */
  excludedFinishMinutes: number | null;
}

export interface ThresholdGradeMetrics {
  /** `reps` found in the stream, a `continuous` tempo block, or the `whole_run` averages. */
  segmentation: "reps" | "continuous" | "whole_run";
  workMinutes: number;
  repCount: number;
  /** Seconds per km. */
  workAvgPaceSecPerKm: number | null;
  /** Work pace vs target, percent; negative is faster than threshold. */
  paceDeltaPct: number | null;
  workAvgHr: number | null;
  /** Share of work time in Z4 / Z5, 0-100. */
  pctWorkZ4: number | null;
  pctWorkZ5: number | null;
  firstRepHr: number | null;
  lastRepHr: number | null;
  /** Pace:HR decoupling between the first and second half of the work, percent. */
  decouplingPct: number | null;
}

export interface SessionGrade {
  workoutLogId: string;
  planDayId: string;
  planId: string | null;
  date: string;
  weekNumber: number | null;
  /** The plan day's title, e.g. "Threshold Run". */
  title: string;
  intent: SessionGradeIntent;
  purpose: RunPurpose;
  /** Why we read the day as this purpose. */
  intentReason: string | null;
  verdict: SessionGradeVerdict;
  headline: string;
  /** One to three plain sentences backing the verdict. */
  evidence: string[];
  confidence: SessionGradeConfidence | null;
  dataSource: SessionGradeDataSource | null;
  streamStatus: SessionStreamState;
  ungradeableReason: SessionUngradeableReason | null;
  targets: SessionGradeTargets;
  easy: EasyGradeMetrics | null;
  threshold: ThresholdGradeMetrics | null;
  /**
   * False for all but one log when a plan day has several: the rollups count
   * each planned session once, by its best-recorded log.
   */
  countsInRollup: boolean;
}

/** Verdict counts for one intent. */
export interface SessionGradeVerdictCounts {
  onTarget: number;
  creptUp: number;
  tooHard: number;
  driftedHarder: number;
  under: number;
  inconclusive: number;
  ungradeable: number;
}

export interface SessionGradeRollupCounts {
  easy: SessionGradeVerdictCounts;
  threshold: SessionGradeVerdictCounts;
  /** Sessions with a definite verdict (not inconclusive / ungradeable). */
  graded: number;
  onTarget: number;
  /** onTarget / graded, 0-1; null when nothing was graded. */
  onTargetRate: number | null;
  /** Threshold runs that went harder than threshold. */
  driftedHarder: number;
  /** Easy runs that crept up or were too hard. */
  easyTooHard: number;
  ungradeable: number;
  /** Graded from the summary while the stream is still on its way. */
  pending: number;
  /** Plan days in the period whose purpose is gradeable, whatever happened to them. */
  plannedGradeable: number;
}

export interface SessionGradeWeek {
  weekNumber: number;
  /** Monday of the plan week, YYYY-MM-DD; null for an unscheduled plan. */
  weekStart: string | null;
  block: number;
  phase: TrainingPhase | null;
  deload: boolean;
  counts: SessionGradeRollupCounts;
}

export interface SessionGradeBlock {
  block: number;
  firstWeek: number;
  lastWeek: number;
  phases: TrainingPhase[];
  includesDeload: boolean;
  counts: SessionGradeRollupCounts;
}

export interface SessionGradesPlanSummary {
  id: string;
  name: string;
  totalWeeks: number;
  startDate: string | null;
  /** The plan week today falls in, clamped to the plan. */
  currentWeek: number | null;
}

export interface SessionGradesResponse {
  plan: SessionGradesPlanSummary | null;
  /** Newest first. */
  sessions: SessionGrade[];
  weeks: SessionGradeWeek[];
  blocks: SessionGradeBlock[];
  /** Plan totals. */
  totals: SessionGradeRollupCounts | null;
}

export interface WorkoutSessionGradeResponse {
  grade: SessionGrade | null;
}

/** The slice of a grade a Weekly Review session row shows. */
export type SessionGradeChip = Pick<
  SessionGrade,
  "intent" | "purpose" | "verdict" | "confidence" | "headline" | "streamStatus"
>;

/** The Weekly Review's one line about the week's graded runs. */
export interface WeeklyReviewGradeSummary {
  graded: number;
  onTarget: number;
  driftedHarder: number;
  easyTooHard: number;
}
