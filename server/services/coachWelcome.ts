import { dayDiff } from "@shared/dateUtils";
import type { CoachQuickAction, CoachWelcome } from "@shared/schema";

import type { TrainingContext } from "../gemini/types";
import { storage } from "../storage";
import { buildTrainingContext } from "./ai";
import { getCachedTrainingContext } from "./trainingContextCache";

/**
 * The coach chat's opening line and prompt chips, built from the athlete's
 * own training (AI coach chat review, I19): today's session, how their load
 * is trending, a race coming up, new bests, a missed session to decide on.
 * They used to be fixed text and four fixed chips, two of them generic
 * ("Pacing tips", "Exercise form tips"). Deterministic: no model call, so the
 * panel can ask for it every time it opens.
 */

type Workout = NonNullable<TrainingContext["upcomingWorkouts"]>[number];
type RecentWorkout = TrainingContext["recentWorkouts"][number];

export interface CoachWelcomeInput {
  readonly firstName: string | null | undefined;
  readonly context: TrainingContext;
  /** Days from the athlete's today to their plan's race day; null without one ahead. */
  readonly daysToRace: number | null;
}

const MAX_ACTIONS = 4;
const MAX_FOCUS_CHARS = 40;
/** A race this close is worth leading with, and asking about. */
const RACE_HORIZON_DAYS = 21;

/** The session's name as a chip can carry it. */
function shortFocus(focus: string): string {
  const name = focus.trim() || "session";
  return name.length > MAX_FOCUS_CHARS ? `${name.slice(0, MAX_FOCUS_CHARS - 1).trimEnd()}…` : name;
}

function weekday(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

type SessionKind = "run" | "strength" | "other";

const RUN_WORDS = /\b(?:run|runs|running|tempo|intervals?|threshold|fartlek|jog|track)\b/;
const STRENGTH_WORDS = /\b(?:strength|squats?|deadlifts?|press|lunges?|sled|lifting)\b/;

function sessionKind(workout: Workout): SessionKind {
  const categories = new Set((workout.exerciseDetails ?? []).map((exercise) => exercise.category));
  if (categories.has("running")) return "run";
  if (categories.has("strength")) return "strength";
  const text = `${workout.focus} ${workout.mainWorkout}`.toLowerCase();
  if (RUN_WORDS.test(text)) return "run";
  if (STRENGTH_WORDS.test(text)) return "strength";
  return "other";
}

function todaySessionAction(workout: Workout): CoachQuickAction {
  const focus = shortFocus(workout.focus);
  const kind = sessionKind(workout);
  if (kind === "run") {
    return { id: "today-session", label: `Pacing for today's ${focus}`, message: `How should I pace today's ${focus}?` };
  }
  if (kind === "strength") {
    return { id: "today-session", label: `Cues for today's ${focus}`, message: `What should I focus on in today's ${focus}?` };
  }
  return { id: "today-session", label: `Today's ${focus}`, message: `How should I approach today's ${focus}?` };
}

function raceLine(daysToRace: number): string {
  if (daysToRace === 0) return "It's race day. Good luck out there.";
  if (daysToRace === 1) return "Race day is tomorrow.";
  return `Race day is ${daysToRace} days away.`;
}

/** What today looks like, from the plan: the session, the one just done, or the next one. */
function dayLine(today: Workout | undefined, doneToday: RecentWorkout | undefined, next: Workout | undefined): string | null {
  if (today) return `Today: ${shortFocus(today.focus)}.`;
  if (doneToday) return `Nice work on today's ${shortFocus(doneToday.focus)}.`;
  if (next) return `Next up: ${shortFocus(next.focus)} on ${weekday(next.date)}.`;
  return null;
}

/** The one thing worth flagging about recent training, most pressing first. */
function statusLine(context: TrainingContext): string | null {
  const insights = context.coachingInsights;
  const zone = insights?.loadGovernor?.zone;
  if (zone === "danger") return "Your training load has jumped well past what you're used to, so recovery matters this week.";
  if (zone === "yellow") return "Your load is climbing faster than usual.";
  if (insights?.fatigueFlag) return "Your last few sessions have felt hard.";
  const prs = insights?.prsThisWeek ?? 0;
  if (prs > 0) return `You've set ${prs} personal best${prs === 1 ? "" : "s"} this week.`;
  return null;
}

interface Signals {
  readonly today: Workout | undefined;
  readonly doneToday: RecentWorkout | undefined;
  readonly next: Workout | undefined;
  readonly raceSoon: boolean;
}

function readSignals(context: TrainingContext, daysToRace: number | null): Signals {
  const date = context.currentDate;
  const upcoming = context.upcomingWorkouts ?? [];
  return {
    today: upcoming.find((workout) => workout.date === date),
    doneToday: context.recentWorkouts.find((workout) => workout.date === date && workout.status === "completed"),
    next: upcoming.find((workout) => !date || workout.date > date),
    raceSoon: daysToRace !== null && daysToRace <= RACE_HORIZON_DAYS,
  };
}

/** The chips that come from the athlete's situation, most relevant first. */
function situationalActions(context: TrainingContext, signals: Signals): CoachQuickAction[] {
  const insights = context.coachingInsights;
  const actions: CoachQuickAction[] = [];
  if (signals.today) actions.push(todaySessionAction(signals.today));
  if (signals.raceSoon) actions.push({ id: "race-prep", label: "Getting ready for race day", message: "How should I prepare for race day?" });
  const zone = insights?.loadGovernor?.zone;
  if (zone === "danger" || zone === "yellow" || insights?.fatigueFlag) {
    actions.push({ id: "ease-off", label: "Should I ease off?", message: "Should I ease off this week?" });
  }
  if (signals.doneToday) {
    const focus = shortFocus(signals.doneToday.focus);
    actions.push({ id: "review-today", label: `How did ${focus} go?`, message: `How did today's ${focus} go?` });
  }
  const missed = insights?.recentMisses?.find((miss) => miss.decision === "undecided");
  if (missed) {
    const focus = shortFocus(missed.focus);
    actions.push({ id: "missed-session", label: `My missed ${focus}`, message: `What should I do about my missed ${focus}?` });
  }
  if ((insights?.prsThisWeek ?? 0) > 0) {
    actions.push({ id: "new-bests", label: "My new bests", message: "What do my new personal bests this week mean for my training?" });
  }
  return actions;
}

/** The standing chips that fill the row: workout suggestions, tomorrow, last week, the goal. */
function standingActions(context: TrainingContext): CoachQuickAction[] {
  if (context.totalWorkouts === 0 && !context.activePlan) {
    return [
      { id: "suggestions", label: "Get workout suggestions" },
      { id: "analyze", label: "Analyze my training" },
      { id: "getting-started", label: "Where should I start?", message: "I'm new here. Where should I start with my training?" },
    ];
  }
  return [
    { id: "suggestions", label: "Get workout suggestions" },
    { id: "tomorrow", label: "What should I do tomorrow?" },
    { id: "weekly-review", label: "How did last week go?" },
    ...(context.activePlan?.goal ? [{ id: "on-track", label: "Am I on track for my goal?" }] : []),
    { id: "analyze", label: "Analyze my training" },
  ];
}

function uniqueById(actions: readonly CoachQuickAction[]): CoachQuickAction[] {
  const byId = new Map<string, CoachQuickAction>();
  for (const action of actions) {
    if (!byId.has(action.id)) byId.set(action.id, action);
  }
  return [...byId.values()];
}

export function buildCoachWelcome({ firstName, context, daysToRace }: CoachWelcomeInput): CoachWelcome {
  const signals = readSignals(context, daysToRace);
  const name = firstName?.trim();
  const lines = [
    name ? `Hi ${name}!` : "Hi!",
    signals.raceSoon && daysToRace !== null ? raceLine(daysToRace) : null,
    dayLine(signals.today, signals.doneToday, signals.next),
    statusLine(context),
    "What would you like to work on?",
  ].filter((line): line is string => line !== null);

  const quickActions = uniqueById([...situationalActions(context, signals), ...standingActions(context)]);
  return { greeting: lines.join(" "), quickActions: quickActions.slice(0, MAX_ACTIONS) };
}


/** Days from `today` to a race day still ahead; null for none, or one already past. */
export function daysUntilRace(raceDate: string | null | undefined, today: string | undefined): number | null {
  if (!raceDate || !today) return null;
  const days = dayDiff(today, raceDate);
  return days >= 0 ? days : null;
}

/**
 * The welcome for the athlete now. Reads the training context through the
 * chat's cache, so opening the panel also readies it for the first message.
 */
export async function getCoachWelcome(userId: string): Promise<CoachWelcome> {
  const [user, plan, context] = await Promise.all([
    storage.users.getUser(userId),
    storage.plans.getActivePlan(userId),
    getCachedTrainingContext(userId, buildTrainingContext),
  ]);
  return buildCoachWelcome({
    firstName: user?.firstName,
    context,
    daysToRace: daysUntilRace(plan?.raceDate, context.currentDate),
  });
}
