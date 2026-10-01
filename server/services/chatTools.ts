import { addDaysToISODate, dayDiff } from "@shared/dateUtils";
import type { PersonalRecord, PersonalRecordValue } from "@shared/schema";
import { getStoredDistanceUnit } from "@shared/unitConversion";
import { formatMinutes, minutes } from "@shared/units";
import type { Logger } from "pino";
import { z } from "zod";

import type { TextAiTool, TextAiToolCall } from "../ai/providers";
import { formatExerciseSetsForPrompt } from "../prompts/exerciseSetFormatter";
import { storage } from "../storage";
import type { LoggedExerciseSetWithDate } from "../storage/shared";
import { sanitizeUserInput } from "../utils/sanitize";
import { calculatePersonalRecords } from "./analyticsService";
import { retrieveCoachingContext } from "./ragRetrieval";

/**
 * The coach chat's tools (AI coach chat review, I8). Read tools let the
 * reasoning model look past the training data in its prompt — "what did I
 * squat in July?" — and `propose_plan_changes` lets it raise a proposal
 * itself, with the whole conversation in view, instead of a keyword gate and
 * a classifier guessing from the last message.
 *
 * Every tool reads only the athlete the request is for: the user id is bound
 * here, never an argument. Arguments are validated, ranges and results are
 * capped, and the athlete's own text in a result is sanitised like anywhere
 * else it reaches a prompt.
 */

export const PROPOSE_PLAN_CHANGES = "propose_plan_changes";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 92;
const MAX_ROWS = 40;
const MAX_TEXT = 300;
const MAX_RESULT_CHARS = 8_000;
const MAX_UPCOMING_DAYS = 60;
const MONTH_DAYS = 30;

export const CHAT_READ_TOOLS: TextAiTool[] = [
  {
    name: "get_workouts",
    description:
      "The athlete's logged sessions, and planned sessions still ahead, between two dates at most 92 days apart. Use it for sessions older than the recent ones in the training data, or further ahead than the upcoming ones.",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "First date, YYYY-MM-DD" },
        to: { type: "string", description: "Last date, YYYY-MM-DD" },
      },
      required: ["from", "to"],
    },
  },
  {
    name: "get_exercise_history",
    description:
      "Every logged session of one exercise over recent months (6 unless you ask for up to 24), newest first, with its sets, reps, loads, distances and times. Use it for questions like 'what did I squat in July?' or 'how has my rowing pace moved?'.",
    parameters: {
      type: "object",
      properties: {
        exercise: { type: "string", description: "The exercise, e.g. 'back squat' or 'sled push'" },
        months: { type: "integer", minimum: 1, maximum: 24 },
      },
      required: ["exercise"],
    },
  },
  {
    name: "get_personal_records",
    description: "The athlete's all-time bests per exercise, with the date each was set.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "search_coaching_materials",
    description:
      "Search the athlete's uploaded coaching notes for passages about a question. Name the material when you use what it says.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "What to look for" } },
      required: ["query"],
    },
  },
];

export const PROPOSE_PLAN_CHANGES_TOOL: TextAiTool = {
  name: PROPOSE_PLAN_CHANGES,
  description:
    "Draft changes to the athlete's upcoming plan as a proposal card that they review and apply. Call it when the athlete asks for a change, or agrees to one you offered. Describe the change in plain words; the app works out the details from their plan. Calling it does not change the plan: only the athlete applying the card does.",
  parameters: {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: "The change to make, e.g. 'Move Saturday's long run to Sunday and make Friday an easy run'",
      },
    },
    required: ["request"],
  },
};

const getWorkoutsArgs = z
  .object({ from: z.string().regex(DATE), to: z.string().regex(DATE) })
  .refine(({ from, to }) => from <= to && dayDiff(from, to) <= MAX_RANGE_DAYS, {
    message: `from must not be after to, and at most ${MAX_RANGE_DAYS} days before it`,
  });
const exerciseHistoryArgs = z.object({
  exercise: z.string().trim().min(2).max(80),
  months: z.number().int().min(1).max(24).optional(),
});
const searchArgs = z.object({ query: z.string().trim().min(2).max(300) });

/** What the tools need to know about the request they run for. */
export interface ChatToolContext {
  readonly userId: string;
  /** The athlete's local date. */
  readonly today: string;
  readonly weightUnit: string;
  readonly distanceUnit: string;
  readonly log: Pick<Logger, "warn" | "error">;
}

/** Athlete text in a result: cut short, and sanitised like any other text that reaches a prompt. */
function clean(text: string | null | undefined): string | undefined {
  const trimmed = text?.trim();
  if (!trimmed) return undefined;
  return sanitizeUserInput(trimmed.length > MAX_TEXT ? `${trimmed.slice(0, MAX_TEXT)}…` : trimmed);
}

/** A result as the model reads it: JSON, with its lists halved until it fits. */
function result(value: Record<string, unknown>): string {
  const out: Record<string, unknown> = { ...value };
  let json = JSON.stringify(out);
  while (json.length > MAX_RESULT_CHARS) {
    const lists = Object.entries(out).filter(
      (entry): entry is [string, unknown[]] => Array.isArray(entry[1]) && entry[1].length > 1,
    );
    if (lists.length === 0) break;
    for (const [key, list] of lists) out[key] = list.slice(0, Math.ceil(list.length / 2));
    out.truncated = true;
    json = JSON.stringify(out);
  }
  return json;
}

function setsByLog(sets: readonly LoggedExerciseSetWithDate[]): Map<string, LoggedExerciseSetWithDate[]> {
  const byLog = new Map<string, LoggedExerciseSetWithDate[]>();
  for (const set of sets) {
    const list = byLog.get(set.workoutLogId);
    if (list) list.push(set);
    else byLog.set(set.workoutLogId, [set]);
  }
  return byLog;
}

async function getWorkouts(args: unknown, ctx: ChatToolContext): Promise<string> {
  const { from, to } = getWorkoutsArgs.parse(args);
  const units = { weightUnit: ctx.weightUnit, distanceUnit: ctx.distanceUnit };
  const [logs, sets, upcoming] = await Promise.all([
    storage.analytics.getWorkoutLogsByDateRange(ctx.userId, from, to),
    storage.analytics.getAllExerciseSetsWithDates(ctx.userId, from, to),
    to >= ctx.today ? storage.timeline.getUpcomingPlannedDays(ctx.userId, MAX_UPCOMING_DAYS) : Promise.resolve([]),
  ]);
  const byLog = setsByLog(sets);
  const workouts = logs
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ROWS)
    .map((log) => ({
      date: log.date,
      focus: clean(log.focus),
      durationMin: log.duration ?? undefined,
      rpe: log.rpe ?? undefined,
      exercises: formatExerciseSetsForPrompt(byLog.get(log.id), units) || clean(log.mainWorkout),
      note: clean(log.notes),
    }));
  const planned = upcoming
    .filter((day) => day.date >= from && day.date <= to)
    .slice(0, MAX_ROWS)
    .map((day) => ({ date: day.date, focus: clean(day.focus), workout: clean(day.mainWorkout) }));
  return result({ from, to, workouts, planned });
}

/** Does this logged set belong to the exercise asked about? By its id-like name, or its custom label. */
function matchesExercise(set: LoggedExerciseSetWithDate, wanted: string): boolean {
  const name = set.exerciseName.toLowerCase();
  const label = set.customLabel?.toLowerCase() ?? "";
  const spaced = name.replaceAll("_", " ");
  return name === wanted.replaceAll(" ", "_") || spaced.includes(wanted) || (label !== "" && label.includes(wanted));
}

async function getExerciseHistory(args: unknown, ctx: ChatToolContext): Promise<string> {
  const { exercise, months = 6 } = exerciseHistoryArgs.parse(args);
  const from = addDaysToISODate(ctx.today, -months * MONTH_DAYS);
  const wanted = exercise.toLowerCase();
  const sets = await storage.analytics.getAllExerciseSetsWithDates(ctx.userId, from, ctx.today);
  const matching = sets.filter((set) => matchesExercise(set, wanted));
  const units = { weightUnit: ctx.weightUnit, distanceUnit: ctx.distanceUnit };
  const sessions = [...setsByLog(matching).values()]
    .map((logSets) => ({ date: logSets[0].date, sets: formatExerciseSetsForPrompt(logSets, units) }))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, MAX_ROWS);
  return result({
    exercise: clean(exercise),
    since: from,
    sessions,
    ...(sessions.length === 0 ? { note: `No logged sets of that exercise since ${from}.` } : {}),
  });
}

interface RecordLine {
  readonly exercise: string;
  readonly best: string;
  readonly date: string;
  readonly sort: number;
}

/** The headline best for each exercise, the way the coach's training data shows them, with its date. */
function recordLine(key: string, pr: PersonalRecord, weightUnit: string, distanceUnit: string): RecordLine | undefined {
  const exercise = pr.customLabel?.trim() || key.replace(/^custom:/, "").replaceAll("_", " ");
  const line = (best: string, value: PersonalRecordValue, sort: number) => ({ exercise, best, date: value.date, sort });
  if (pr.estimated1RM) return line(`e1RM ${pr.estimated1RM.value}${weightUnit}`, pr.estimated1RM, pr.estimated1RM.value);
  if (pr.maxWeight) return line(`max weight ${pr.maxWeight.value}${weightUnit}`, pr.maxWeight, pr.maxWeight.value);
  if (pr.bestTime) return line(`best time ${formatMinutes(minutes(pr.bestTime.value))}`, pr.bestTime, 0);
  if (pr.maxDistance) {
    return line(`max distance ${pr.maxDistance.value}${getStoredDistanceUnit(distanceUnit)}`, pr.maxDistance, 0);
  }
  return undefined;
}

async function getPersonalRecords(ctx: ChatToolContext): Promise<string> {
  const sets = await storage.analytics.getExerciseSetsForPersonalRecords(ctx.userId, undefined, undefined, {
    onlyTraining: true,
  });
  const prs = calculatePersonalRecords(sets, { weightUnit: ctx.weightUnit, distanceUnit: ctx.distanceUnit });
  const records = Object.entries(prs)
    .flatMap(([key, pr]) => {
      const line = recordLine(key, pr, ctx.weightUnit, ctx.distanceUnit);
      return line ? [line] : [];
    })
    .sort((a, b) => b.sort - a.sort)
    .slice(0, MAX_ROWS)
    .map(({ exercise, best, date }) => ({ exercise: clean(exercise), best, date }));
  return result({ records });
}

async function searchCoachingMaterials(args: unknown, ctx: ChatToolContext): Promise<string> {
  const { query } = searchArgs.parse(args);
  const found = await retrieveCoachingContext(ctx.userId, query, ctx.log);
  const excerpts = found.retrievedChunks?.length
    ? found.retrievedChunks
    : (found.coachingMaterials ?? []).map((material) => `${material.title}\n${material.content}`);
  return result({
    query: clean(query),
    excerpts: excerpts.map((excerpt) => sanitizeUserInput(excerpt.slice(0, 1_500))),
    ...(excerpts.length === 0 ? { note: "Nothing in the athlete's coaching notes matched." } : {}),
  });
}

/**
 * Run a read tool and return its result as the model reads it. Never throws:
 * bad arguments and failed reads come back as an error the model can work
 * around.
 */
export async function runChatTool(call: TextAiToolCall, ctx: ChatToolContext): Promise<string> {
  try {
    switch (call.name) {
      case "get_workouts":
        return await getWorkouts(call.arguments, ctx);
      case "get_exercise_history":
        return await getExerciseHistory(call.arguments, ctx);
      case "get_personal_records":
        return await getPersonalRecords(ctx);
      case "search_coaching_materials":
        return await searchCoachingMaterials(call.arguments, ctx);
      default:
        return JSON.stringify({ error: `There is no tool called ${call.name}.` });
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      return JSON.stringify({ error: `Invalid arguments: ${error.issues.map((issue) => issue.message).join("; ")}` });
    }
    // A storage or retrieval error and the tool's name; no athlete data.
    // bearer:disable javascript_lang_logger_leak
    ctx.log.warn({ err: error, tool: call.name }, "[chat] A chat tool failed");
    return JSON.stringify({ error: "That lookup failed. Answer from the training data you have." });
  }
}

/** The tools to offer: the read tools, and plan changes where the surface can show a proposal. */
export function chatToolsFor({ planChanges }: { planChanges: boolean }): TextAiTool[] {
  return planChanges ? [...CHAT_READ_TOOLS, PROPOSE_PLAN_CHANGES_TOOL] : CHAT_READ_TOOLS;
}
