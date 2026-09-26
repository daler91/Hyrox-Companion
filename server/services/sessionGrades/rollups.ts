/**
 * Roll session grades up by plan week and by training block.
 *
 * Weeks are the plan's own `week_number` — the week the session was prescribed
 * for — not a calendar week, so a session moved into the next week by
 * missed-session recovery still counts toward the week it belonged to, and no
 * timezone decides which week a late-night run falls in.
 *
 * Blocks come from the same outline the plan generator wrote the plan with
 * (planBlueprint.ts: a new block after each deload week, phases from
 * computePlanPhase). A plan that was imported or written by hand never went
 * through that outline, so when any day's text says "deload" those weeks are
 * taken as the deloads instead, and the blocks follow them.
 */
import { addDaysToISODate, planWeekOneMonday } from "@shared/dateUtils";
import type {
  SessionGrade,
  SessionGradeBlock,
  SessionGradeRollupCounts,
  SessionGradeVerdict,
  SessionGradeVerdictCounts,
  SessionGradeWeek,
} from "@shared/schema";

import { buildPlanOutline, type PlanWeekOutline } from "../planBlueprint";
import { isDefinite } from "./gradeSession";

export interface RollupDay {
  weekNumber: number;
  /** The day's purpose is one we grade. */
  gradeable: boolean;
  /** The day's text calls it a deload. */
  mentionsDeload: boolean;
}

export interface RollupInput {
  totalWeeks: number;
  startDate: string | null;
  days: readonly RollupDay[];
  grades: readonly SessionGrade[];
}

export interface SessionGradeRollups {
  weeks: SessionGradeWeek[];
  blocks: SessionGradeBlock[];
  totals: SessionGradeRollupCounts;
}

const VERDICT_KEYS: Readonly<Record<SessionGradeVerdict, keyof SessionGradeVerdictCounts>> = {
  on_target: "onTarget",
  crept_up: "creptUp",
  too_hard: "tooHard",
  drifted_harder: "driftedHarder",
  under: "under",
  inconclusive: "inconclusive",
  ungradeable: "ungradeable",
};

function emptyVerdicts(): SessionGradeVerdictCounts {
  return { onTarget: 0, creptUp: 0, tooHard: 0, driftedHarder: 0, under: 0, inconclusive: 0, ungradeable: 0 };
}

export function emptyRollupCounts(): SessionGradeRollupCounts {
  return {
    easy: emptyVerdicts(),
    threshold: emptyVerdicts(),
    graded: 0,
    onTarget: 0,
    onTargetRate: null,
    driftedHarder: 0,
    easyTooHard: 0,
    ungradeable: 0,
    pending: 0,
    plannedGradeable: 0,
  };
}

export function addGrade(counts: SessionGradeRollupCounts, grade: SessionGrade): void {
  counts[grade.intent][VERDICT_KEYS[grade.verdict]] += 1;
  if (isDefinite(grade.verdict)) counts.graded += 1;
  if (grade.verdict === "on_target") counts.onTarget += 1;
  if (grade.intent === "threshold" && grade.verdict === "drifted_harder") counts.driftedHarder += 1;
  if (grade.intent === "easy" && (grade.verdict === "crept_up" || grade.verdict === "too_hard")) {
    counts.easyTooHard += 1;
  }
  if (grade.verdict === "ungradeable") counts.ungradeable += 1;
  if (grade.streamStatus === "pending" && grade.dataSource === "summary") counts.pending += 1;
  counts.onTargetRate = counts.graded > 0 ? counts.onTarget / counts.graded : null;
}

function mergeCounts(into: SessionGradeRollupCounts, from: SessionGradeRollupCounts): void {
  for (const intent of ["easy", "threshold"] as const) {
    for (const key of Object.keys(from[intent]) as (keyof SessionGradeVerdictCounts)[]) {
      into[intent][key] += from[intent][key];
    }
  }
  into.graded += from.graded;
  into.onTarget += from.onTarget;
  into.driftedHarder += from.driftedHarder;
  into.easyTooHard += from.easyTooHard;
  into.ungradeable += from.ungradeable;
  into.pending += from.pending;
  into.plannedGradeable += from.plannedGradeable;
  into.onTargetRate = into.graded > 0 ? into.onTarget / into.graded : null;
}

/** The generator's outline, with deloads taken from the plan's text when it names any. */
function planOutline(totalWeeks: number, textDeloads: ReadonlySet<number>): PlanWeekOutline[] {
  const outline = buildPlanOutline(totalWeeks);
  if (textDeloads.size === 0) return outline;
  let block = 1;
  return outline.map((entry) => {
    const deload = textDeloads.has(entry.week);
    const next = { ...entry, deload, block };
    if (deload) block += 1;
    return next;
  });
}

export function buildSessionGradeRollups(input: RollupInput): SessionGradeRollups {
  // Plan weeks are numbered however the plan was written (CSV imports can
  // start at 0); the outline counts from 1.
  const weekNumbers = [...input.days.map((day) => day.weekNumber), ...input.grades.flatMap((g) => g.weekNumber ?? [])];
  const firstWeek = weekNumbers.length > 0 ? Math.min(...weekNumbers) : 1;
  const totalWeeks = Math.max(input.totalWeeks, ...weekNumbers.map((week) => week - firstWeek + 1), 1);
  const toIndex = (weekNumber: number) => weekNumber - firstWeek + 1;

  const textDeloads = new Set(input.days.filter((day) => day.mentionsDeload).map((day) => toIndex(day.weekNumber)));
  const outline = planOutline(totalWeeks, textDeloads);
  const weekOneMonday = input.startDate ? planWeekOneMonday(input.startDate) : null;

  const weeks: SessionGradeWeek[] = outline.map((entry) => ({
    weekNumber: entry.week + firstWeek - 1,
    weekStart: weekOneMonday ? addDaysToISODate(weekOneMonday, (entry.week - 1) * 7) : null,
    block: entry.block,
    phase: entry.phase,
    deload: entry.deload,
    counts: emptyRollupCounts(),
  }));
  const weekAt = (weekNumber: number | null) =>
    weekNumber === null ? undefined : weeks[toIndex(weekNumber) - 1];

  for (const day of input.days) {
    const week = weekAt(day.weekNumber);
    if (week && day.gradeable) week.counts.plannedGradeable += 1;
  }
  for (const grade of input.grades) {
    if (!grade.countsInRollup) continue;
    const week = weekAt(grade.weekNumber);
    if (week) addGrade(week.counts, grade);
  }

  const blocks = new Map<number, SessionGradeBlock>();
  const totals = emptyRollupCounts();
  for (const week of weeks) {
    let block = blocks.get(week.block);
    if (!block) {
      block = {
        block: week.block,
        firstWeek: week.weekNumber,
        lastWeek: week.weekNumber,
        phases: [],
        includesDeload: false,
        counts: emptyRollupCounts(),
      };
      blocks.set(week.block, block);
    }
    block.lastWeek = week.weekNumber;
    if (week.phase && !block.phases.includes(week.phase)) block.phases.push(week.phase);
    block.includesDeload ||= week.deload;
    mergeCounts(block.counts, week.counts);
    mergeCounts(totals, week.counts);
  }

  return { weeks, blocks: [...blocks.values()], totals };
}
