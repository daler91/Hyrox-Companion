import { formatPace, metersToUserDistance } from "@shared/unitConversion";

import type { FocusedWorkout } from "../services/focusedWorkoutService";
import { sanitizeUserInput } from "../utils/sanitize";
import { relativeDayLabel } from "./coachingContext";
import { formatExerciseSetsForPrompt } from "./exerciseSetFormatter";
import { priorAiContextParts } from "./priorAiContext";

/**
 * FOCUSED WORKOUT: the session the athlete opened the workout-detail chat
 * from. The general context lists only the last seven workouts and the next
 * planned days, so without this a session outside those windows — or any
 * unplanned log — was invisible, and the coach answered from the seed
 * question alone.
 */

interface FocusedWorkoutContext {
  weightUnit?: string;
  distanceUnit?: string;
  currentDate?: string;
}

interface Units {
  weightUnit: string;
  distanceUnit: string;
}

/** Long enough for a full prescription, short enough that one field can't crowd the prompt. */
const FREE_TEXT_MAX_CHARS = 1200;

function freeText(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? sanitizeUserInput(trimmed.slice(0, FREE_TEXT_MAX_CHARS)) : undefined;
}

function headerLine({ planDay, log }: FocusedWorkout, currentDate: string | undefined): string {
  const focus = freeText(log?.focus ?? planDay?.focus) ?? "Workout";
  const date = log?.date ?? planDay?.scheduledDate ?? undefined;
  const when = date ? ` on ${date}${relativeDayLabel(date, currentDate)}` : "";
  const status = planDay?.status ?? "logged, unplanned";
  const tier = planDay?.priority ? ` [${planDay.priority} session]` : "";
  return `Workout: ${focus}${when}${tier} — status: ${status}`;
}

/** What was asked for: the log's snapshot of its prescription when it has one, else the plan day. */
function prescriptionLines({ planDay, log, plannedSets }: FocusedWorkout, units: Units): string[] {
  const main = freeText(log?.prescribedMainWorkout ?? planDay?.mainWorkout);
  const accessory = freeText(log?.prescribedAccessory ?? planDay?.accessory);
  const notes = freeText(log?.prescribedNotes ?? planDay?.notes);
  const sets = formatExerciseSetsForPrompt(plannedSets, units);
  const expected = [
    planDay?.expectedDurationMin ? `${planDay.expectedDurationMin}min` : undefined,
    planDay?.expectedRpe ? `RPE ${planDay.expectedRpe}` : undefined,
  ].filter(Boolean);
  return [
    main ? `Planned: ${main}` : undefined,
    accessory ? `Planned accessory: ${accessory}` : undefined,
    notes ? `Plan notes: ${notes}` : undefined,
    sets ? `Planned sets: ${sets}` : undefined,
    expected.length > 0 ? `Expected: ${expected.join(", ")}` : undefined,
  ].filter((line): line is string => line !== undefined);
}

type Log = NonNullable<FocusedWorkout["log"]>;

function heartRateText(log: Log): string | undefined {
  if (!log.avgHeartrate) return undefined;
  const max = log.maxHeartrate ? ` (max ${log.maxHeartrate})` : "";
  return `Avg HR: ${log.avgHeartrate}${max}`;
}

function metricsLine(log: Log, units: Units): string | undefined {
  const distance = log.distanceMeters
    ? `Distance: ${metersToUserDistance(log.distanceMeters, units.distanceUnit).toFixed(2)} ${units.distanceUnit}`
    : undefined;
  const metrics = [
    log.duration ? `Duration: ${log.duration}min` : undefined,
    log.rpe ? `RPE: ${log.rpe}` : undefined,
    distance,
    heartRateText(log),
    log.avgSpeed ? `Avg pace: ${formatPace(log.avgSpeed, units.distanceUnit)}` : undefined,
  ].filter(Boolean);
  return metrics.length > 0 ? `Logged: ${metrics.join(", ")}` : undefined;
}

function adherenceLine(log: Log): string | undefined {
  if (log.compliancePct == null) return undefined;
  const counts = [
    log.plannedSetCount == null ? undefined : `planned ${log.plannedSetCount}`,
    log.actualSetCount == null ? undefined : `done ${log.actualSetCount}`,
    log.matchedSetCount == null ? undefined : `matched ${log.matchedSetCount}`,
    log.addedSetCount ? `added ${log.addedSetCount}` : undefined,
    log.removedSetCount ? `removed ${log.removedSetCount}` : undefined,
  ].filter(Boolean);
  const detail = counts.length > 0 ? ` (${counts.join(", ")})` : "";
  return `Adherence: ${log.compliancePct}% of the planned sets${detail}`;
}

/** What happened, when the session has been logged. */
function loggedLines({ log, loggedSets }: FocusedWorkout, units: Units): string[] {
  if (!log) return [];
  const sets = formatExerciseSetsForPrompt(loggedSets, units);
  // The log's own text, when it says something the prescription didn't.
  const main = freeText(log.mainWorkout);
  const differs = main && main !== freeText(log.prescribedMainWorkout);
  const note = freeText(log.notes);
  return [
    metricsLine(log, units),
    sets ? `Logged sets: ${sets}` : undefined,
    !sets && differs ? `Logged as: ${main}` : undefined,
    note ? `Athlete note: ${note}` : undefined,
    adherenceLine(log),
  ].filter((line): line is string => line !== undefined);
}

function gradeLine({ grade }: FocusedWorkout): string | undefined {
  if (!grade) return undefined;
  const evidence = grade.evidence.length > 0 ? ` ${grade.evidence.join(" ")}` : "";
  return `Session grade: ${grade.headline}.${evidence}`;
}

function coachNoteLine({ planDay }: FocusedWorkout): string | undefined {
  const parts = planDay ? priorAiContextParts(planDay) : [];
  return parts.length > 0 ? `Coach notes: ${parts.join(" | ")}` : undefined;
}

export function formatFocusedWorkout(
  focused: FocusedWorkout,
  context: FocusedWorkoutContext = {},
): string {
  const units: Units = {
    weightUnit: context.weightUnit ?? "kg",
    distanceUnit: context.distanceUnit ?? "km",
  };
  return [
    "--- FOCUSED WORKOUT ---",
    `The athlete is chatting from this workout's page, so "this workout" or "this session" means it, whatever its date. Answer about it first.`,
    headerLine(focused, context.currentDate),
    ...prescriptionLines(focused, units),
    ...loggedLines(focused, units),
    gradeLine(focused),
    coachNoteLine(focused),
    "--- END FOCUSED WORKOUT ---",
  ]
    .filter((line): line is string => line !== undefined)
    .join("\n");
}
