import { dayDiff } from "@shared/dateUtils";
import type { EnrichedPlanAdjustmentChange, PlanAdjustmentProposal, PlanDayMoveKind } from "@shared/schema";

import { appliedPlanDayIds, isUndoable } from "../services/planProposalUndo";
import type { RecentPlanDayMove } from "../storage/planDayMoves";
import { getLocalDateStrSafe } from "../timezone";
import { sanitizeUserInput } from "../utils/sanitize";
import { weekdayDate } from "./coachingContext";

/** How far back the coach's record of its plan changes reaches. */
export const RECENT_PLAN_CHANGES_DAYS = 14;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** When the record is read: the instant, and the athlete's day and time zone. */
interface RecordClock {
  readonly now: number;
  readonly today: string;
  readonly timeZone: string | null | undefined;
}

/**
 * "today", "yesterday", "3 days ago", by the athlete's calendar. Days, not
 * minutes: the record sits in the chat's system prompt, which then reads the
 * same on every turn of a day and stays a cacheable prefix for the
 * conversation sent after it.
 */
function daysAgo(instant: Date, clock: RecordClock): string {
  const days = dayDiff(getLocalDateStrSafe(instant, clock.timeZone), clock.today);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** What a change did to its session besides moving it. */
function edits(change: EnrichedPlanAdjustmentChange): string[] {
  const { updatedFields: fields, baseline } = change;
  if (change.kind === "rest_conversion") return ["turned into a rest day"];
  const parts: string[] = [];
  if (fields.focus !== undefined && fields.focus !== baseline.focus) {
    parts.push(`renamed "${sanitizeUserInput(fields.focus)}"`);
  }
  if (fields.mainWorkout !== undefined || fields.accessory !== undefined) parts.push("workout rewritten");
  if (fields.notes !== undefined || fields.expectedDurationMin !== undefined || fields.expectedRpe !== undefined) {
    parts.push("notes or targets adjusted");
  }
  return parts;
}

/** "Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04", or "Tempo Run on Tuesday 2026-10-06: workout rewritten". */
function describeChange(change: EnrichedPlanAdjustmentChange): string {
  const { updatedFields: fields, baseline } = change;
  // The plan's own text, so sanitised like any athlete text.
  const session = sanitizeUserInput(baseline.focus || "Session");
  const was = baseline.scheduledDate;
  const done = edits(change);
  if (fields.scheduledDate !== undefined && fields.scheduledDate !== was) {
    const from = was ? ` from ${weekdayDate(was)}` : "";
    const also = done.length > 0 ? `, ${done.join(", ")}` : "";
    return `${session} moved${from} to ${weekdayDate(fields.scheduledDate)}${also}`;
  }
  const on = was ? ` on ${weekdayDate(was)}` : "";
  return `${session}${on}: ${done.length > 0 ? done.join(", ") : "adjusted"}`;
}

/** What the record holds: the coach's applied proposals and the athlete's own moves, each newest first. */
export interface RecentPlanChanges {
  readonly proposals?: readonly PlanAdjustmentProposal[];
  readonly moves?: readonly RecentPlanDayMove[];
}

/** One line of the record, with the instant it sorts by. */
interface RecordLine {
  readonly at: number;
  readonly text: string;
}

/** How each kind of move the athlete made reads in the record. */
const MOVE_OUTCOMES: Readonly<Record<PlanDayMoveKind, string>> = {
  moved: "moved by the athlete",
  folded: "rescheduled by the athlete after it was missed",
  shortened: "rescheduled and shortened by the athlete after it was missed",
  recovery_undone: "a missed session's reschedule taken back by the athlete",
};

/** A move the athlete made themselves: "Long Run moved from Monday 2026-10-05 to Sunday 2026-10-04". */
function describeMove(move: RecentPlanDayMove, clock: RecordClock): string {
  // The plan's own text, so sanitised like any athlete text.
  const session = sanitizeUserInput(move.focus || "Session");
  const back = move.kind === "recovery_undone" ? " back" : "";
  return `- ${daysAgo(move.movedAt, clock)}, ${MOVE_OUTCOMES[move.kind]}: ${session} moved from ${weekdayDate(move.fromDate)}${back} to ${weekdayDate(move.toDate)}.`;
}

/** One proposal's line: when it was applied, what became of it, and the changes it made. */
function describeProposal(proposal: PlanAdjustmentProposal, clock: RecordClock): string | undefined {
  if (!proposal.resolvedAt) return undefined;
  const applied = new Set(appliedPlanDayIds(proposal));
  const changes = proposal.payload.changes.filter((change) => applied.has(change.planDayId));
  if (changes.length === 0) return undefined;
  const when = daysAgo(proposal.resolvedAt, clock);
  const part = changes.length < proposal.payload.changes.length ? " in part" : "";
  let outcome = `applied${part}`;
  if (proposal.status === "reverted") {
    const undone = proposal.revertedAt ? ` ${daysAgo(proposal.revertedAt, clock)}` : "";
    outcome = `applied${part}, then undone${undone}, so those sessions are back where they were`;
  }
  const undo = isUndoable(proposal, clock.now) ? " The athlete can still take it back with Undo on its card." : "";
  return `- ${when}, ${outcome}: ${changes.map(describeChange).join("; ")}.${undo}`;
}

/**
 * The coach's record of what changed in the athlete's plan, newest first, for
 * the chat coach and the plan-change step: the proposals the athlete applied,
 * and the moves they made themselves on the timeline or a missed session's
 * card. Dated by the athlete's day in `timeZone` (UTC when absent). Without it
 * neither knew what had changed: asked to undo a card, the coach asked the
 * athlete for the original dates, and it couldn't say what had happened to a
 * session that had moved. Empty when nothing changed in the window.
 */
export function formatRecentPlanChanges(
  changes: RecentPlanChanges,
  now: Date,
  timeZone?: string | null,
): string {
  const clock: RecordClock = { now: now.getTime(), today: getLocalDateStrSafe(now, timeZone), timeZone };
  const proposalLines = (changes.proposals ?? []).flatMap((proposal): RecordLine[] => {
    const text = describeProposal(proposal, clock);
    return text && proposal.resolvedAt ? [{ at: proposal.resolvedAt.getTime(), text }] : [];
  });
  const moveLines = (changes.moves ?? []).map((move): RecordLine => ({ at: move.movedAt.getTime(), text: describeMove(move, clock) }));
  const lines = [...proposalLines, ...moveLines].sort((a, b) => b.at - a.at).map((line) => line.text);
  if (lines.length === 0) return "";
  return [
    "--- RECENT PLAN CHANGES ---",
    `What changed in the athlete's plan in the last ${RECENT_PLAN_CHANGES_DAYS} days, newest first, from your proposals and from the athlete's own moves, with each session's date before and after:`,
    ...lines,
    'When the athlete asks to undo, revert or put something back, or asks what happened to a session, answer from this list: each "from" date is where that session was. Never ask the athlete for a date or detail listed here. A move the athlete made has no Undo card: putting it back means moving the session to its "from" date again. Rescheduling the whole plan to a new start date is not listed.',
    "--- END RECENT PLAN CHANGES ---",
  ].join("\n");
}
