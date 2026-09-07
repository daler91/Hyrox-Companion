/**
 * Device activity matcher.
 *
 * A Strava (later Garmin) activity is a MEASUREMENT of a session the athlete
 * already planned or logged, not a workout of its own. Given one activity and
 * the candidate rows for that local calendar day — the day's open plan days and
 * the day's workout logs that carry no device activity yet — this module
 * decides which row, if any, the activity belongs to.
 *
 * Pure functions only: no database, no clock. The reconciler owns loading
 * candidates and applying the decision. Everything here is deterministic so
 * the thresholds can be tuned against a fixture table without a DB.
 *
 * Scoring is a weighted mean over the signals that are AVAILABLE for a pair,
 * so a plan day with no expected duration is judged on type alone rather than
 * dragged down by a signal nobody filled in. Type compatibility is always
 * available and also acts as a hard damper: a strong duration match can never
 * push a bike ride onto a strength day.
 */

export type DeviceSportKind =
  "run" | "ride" | "row" | "swim" | "walk" | "strength" | "conditioning" | "other";

export type PrescriptionKind =
  "rest" | "run" | "ride" | "row" | "swim" | "walk" | "strength" | "conditioning" | "unknown";

export interface DeviceActivityInput {
  /** Provider id, stringified. Only used to label decisions. */
  externalId: string;
  name: string;
  /** Provider sport type, e.g. Strava `sport_type` ("Run", "Workout"). */
  sportType: string;
  /** YYYY-MM-DD in the athlete's local time. */
  localDate: string;
  /** Minutes from local midnight, when known. */
  localStartMinutes: number | null;
  movingTimeSec: number;
  /** Metres; 0 for non-distance activities. */
  distanceMeters: number;
}

export type MatchCandidateKind = "workout_log" | "plan_day";

export interface MatchCandidate {
  kind: MatchCandidateKind;
  id: string;
  focus: string;
  mainWorkout: string;
  accessory?: string | null;
  /** Logged (workout_log.duration) or expected (plan_day.expected_duration_min) minutes. */
  durationMin: number | null;
  /** Manually entered distance on a log, when present. */
  distanceMeters: number | null;
  /** Manual log time_of_day_min or plan day planned_time_of_day_min. */
  localStartMinutes: number | null;
}

export interface CandidateScore {
  candidate: MatchCandidate;
  score: number;
  /** Per-signal breakdown, for logs and tests. */
  signals: Record<string, number>;
}

export type MatchOutcome = "link" | "suggest" | "none";

export type MatchDecision =
  | { outcome: "link"; candidate: MatchCandidate; score: number }
  | { outcome: "suggest"; candidate: MatchCandidate; score: number }
  | { outcome: "none"; score: number | null };

export interface MatchThresholds {
  /** At or above: attach without asking. */
  autoLink: number;
  /** At or above (and below autoLink): record as a suggestion on the standalone log. */
  suggest: number;
}

export const DEFAULT_MATCH_THRESHOLDS: MatchThresholds = { autoLink: 0.75, suggest: 0.45 };

/**
 * Activities shorter than this never match anything. A 90-second "Workout"
 * is a watch mis-tap far more often than a session, and attaching one to a
 * plan day would mark the day completed on the strength of nothing.
 */
export const MIN_MATCHABLE_MOVING_SEC = 5 * 60;

// ── Classification ──────────────────────────────────────────────────────────

/** Strava sport_type / type → coarse kind. Case-insensitive; unknown → other. */
export function classifyDeviceSport(sportType: string | null | undefined): DeviceSportKind {
  const s = (sportType ?? "").toLowerCase();
  if (!s) return "other";
  if (/run|jog/.test(s)) return "run";
  if (/ride|cycl|bike|velomobile|handcycle/.test(s)) return "ride";
  if (/row|canoe|kayak/.test(s)) return "row";
  if (/swim/.test(s)) return "swim";
  if (/walk|hike/.test(s)) return "walk";
  if (/weight|strength/.test(s)) return "strength";
  if (/workout|crossfit|hiit|intensity|stairstepper|elliptical|circuit/.test(s))
    return "conditioning";
  return "other";
}

// Hyrox stations and the metcon vocabulary. These outrank the run words
// because a sim is prescribed as "8 x 1 km run + stations" and is still a
// conditioning session, not a run.
const CONDITIONING_RE =
  /\b(hyrox|sim(ulation)?|station|sled|wall ?ball|farmers?|sandbag|burpee|ski ?erg|roxzone|compromised|metcon|wod|amrap|emom|for time|circuit|hiit|conditioning|engine|intervals? (?:on the )?(?:bike|erg|rower)|assault|echo bike)\b/i;
const RUN_RE =
  /\b(run|running|tempo|fartlek|strides|track|treadmill|long run|easy miles|threshold|intervals?|repeats|5k|10k|half marathon|marathon)\b/i;
const STRENGTH_RE =
  /\b(strength|lift|lifting|squat|deadlift|bench|press|rdl|pull[- ]?ups?|chin[- ]?ups?|push[- ]?ups?|kettlebell|kb|dumbbell|db|barbell|hypertrophy|accessory|upper body|lower body|full body|reps?|sets?)\b/i;
const RIDE_RE = /\b(bike|cycling|ride|spin|zwift|turbo)\b/i;
const ROW_RE = /\b(rowing|rower|row erg|erg row|\d+ ?m row)\b/i;
const SWIM_RE = /\b(swim|swimming|pool)\b/i;
const WALK_RE = /\b(walk|walking|hike|hiking|ruck|rucking)\b/i;
const REST_RE = /\b(rest|off day|day off|recovery day)\b/i;
const ACTIVE_RE = /\bactive\b/i;

/**
 * What kind of session a plan day / log prescribes, from its text. `focus`
 * carries most of the signal ("Long Run", "Strength", "Hyrox Sim"); the body
 * text breaks ties. Rest wins outright unless it is an "active" recovery.
 */
export function classifyPrescription(
  focus: string,
  mainWorkout: string,
  accessory?: string | null,
): PrescriptionKind {
  const head = focus ?? "";
  const body = [mainWorkout ?? "", accessory ?? ""].join("\n");
  const all = `${head}\n${body}`;

  if (REST_RE.test(head) && !ACTIVE_RE.test(head)) return "rest";

  // Focus alone is decisive when it names a kind; it is the coach's label.
  const fromFocus = kindFromText(head);
  if (fromFocus !== "unknown") return fromFocus;

  const fromAll = kindFromText(all);
  if (fromAll !== "unknown") return fromAll;
  if (REST_RE.test(all) && !ACTIVE_RE.test(all)) return "rest";
  return "unknown";
}

function kindFromText(text: string): PrescriptionKind {
  if (!text.trim()) return "unknown";
  if (CONDITIONING_RE.test(text)) return "conditioning";
  if (SWIM_RE.test(text)) return "swim";
  if (ROW_RE.test(text)) return "row";
  if (RIDE_RE.test(text)) return "ride";
  if (RUN_RE.test(text)) return "run";
  if (WALK_RE.test(text)) return "walk";
  if (STRENGTH_RE.test(text)) return "strength";
  return "unknown";
}

/**
 * How plausibly a device sport kind records a prescription kind. Rows are the
 * device kind. `rest` is zero everywhere: nothing a watch records completes a
 * rest day. `unknown` prescriptions sit in the middle so type never decides
 * the match on its own for them.
 */
const COMPATIBILITY: Record<DeviceSportKind, Record<PrescriptionKind, number>> = {
  run: {
    run: 1,
    ride: 0.05,
    row: 0.05,
    swim: 0,
    walk: 0.3,
    strength: 0.15,
    conditioning: 0.55,
    unknown: 0.6,
    rest: 0,
  },
  ride: {
    run: 0.05,
    ride: 1,
    row: 0.05,
    swim: 0,
    walk: 0.05,
    strength: 0.15,
    conditioning: 0.4,
    unknown: 0.5,
    rest: 0,
  },
  row: {
    run: 0.05,
    ride: 0.05,
    row: 1,
    swim: 0,
    walk: 0,
    strength: 0.2,
    conditioning: 0.7,
    unknown: 0.5,
    rest: 0,
  },
  swim: {
    run: 0,
    ride: 0,
    row: 0,
    swim: 1,
    walk: 0,
    strength: 0.05,
    conditioning: 0.1,
    unknown: 0.4,
    rest: 0,
  },
  walk: {
    run: 0.35,
    ride: 0.05,
    row: 0,
    swim: 0,
    walk: 1,
    strength: 0.1,
    conditioning: 0.2,
    unknown: 0.4,
    rest: 0,
  },
  strength: {
    run: 0.1,
    ride: 0.05,
    row: 0.1,
    swim: 0,
    walk: 0.05,
    strength: 1,
    conditioning: 0.7,
    unknown: 0.6,
    rest: 0,
  },
  conditioning: {
    run: 0.5,
    ride: 0.3,
    row: 0.6,
    swim: 0.05,
    walk: 0.15,
    strength: 0.8,
    conditioning: 1,
    unknown: 0.65,
    rest: 0,
  },
  other: {
    run: 0.4,
    ride: 0.3,
    row: 0.3,
    swim: 0.2,
    walk: 0.3,
    strength: 0.4,
    conditioning: 0.5,
    unknown: 0.5,
    rest: 0,
  },
};

export function typeCompatibility(device: DeviceSportKind, prescription: PrescriptionKind): number {
  return COMPATIBILITY[device][prescription];
}

// ── Signals ─────────────────────────────────────────────────────────────────

const WEIGHTS = { type: 0.4, duration: 0.35, timeOfDay: 0.15, distance: 0.2, name: 0.05 } as const;

/** Below this type score the total is damped towards zero (see scoreCandidate). */
const TYPE_DAMPING_FLOOR = 0.2;

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** 1 when equal, falling to 0 once the relative gap reaches `tolerance`. */
function proximity(a: number, b: number, tolerance: number): number {
  const largest = Math.max(a, b);
  if (largest <= 0) return 1;
  return clamp01(1 - Math.abs(a - b) / largest / tolerance);
}

/** 1 within an hour, then linear to 0 at six hours apart. */
export function timeOfDayProximity(aMin: number, bMin: number): number {
  const diff = Math.abs(aMin - bMin);
  if (diff <= 60) return 1;
  return clamp01(1 - (diff - 60) / 300);
}

const KM_RE = /(\d+(?:[.,]\d+)?)\s*(km|k|kilomet(?:er|re)s?|mi|mile|miles)\b/gi;
const MULTIPLIER_RE = /\d+\s*[x×]\s*\d/i;

/**
 * A single explicit "8 km" / "5 miles" in a prescription, as metres. Returns
 * null unless there is exactly ONE such mention and no "6 x 800m" style
 * multiplier anywhere — a sim prescribes "1 km" eight times and interval
 * work prescribes rep distances, and either would score a correct 9 km
 * activity as a miss. Better no distance signal than a confidently wrong one.
 */
export function parsePrescribedDistanceMeters(text: string): number | null {
  if (!text || MULTIPLIER_RE.test(text)) return null;
  const matches = Array.from(text.matchAll(KM_RE));
  if (matches.length !== 1) return null;
  const value = Number.parseFloat(matches[0][1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = matches[0][2].toLowerCase();
  return unit.startsWith("mi") ? value * 1609.344 : value * 1000;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "with",
  "for",
  "morning",
  "afternoon",
  "evening",
  "lunch",
  "night",
  "session",
  "workout",
  "day",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOP_WORDS.has(t)),
  );
}

/** Jaccard overlap of meaningful tokens; null when either side has none. */
export function nameOverlap(activityName: string, candidateText: string): number | null {
  const a = tokens(activityName);
  const b = tokens(candidateText);
  if (a.size === 0 || b.size === 0) return null;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? null : shared / union;
}

// ── Scoring ─────────────────────────────────────────────────────────────────

export function scoreCandidate(
  activity: DeviceActivityInput,
  candidate: MatchCandidate,
): CandidateScore {
  const deviceKind = classifyDeviceSport(activity.sportType);
  const prescriptionKind = classifyPrescription(
    candidate.focus,
    candidate.mainWorkout,
    candidate.accessory,
  );
  const signals: Record<string, number> = {};
  let weighted = 0;
  let weightSum = 0;

  const add = (name: keyof typeof WEIGHTS, value: number | null) => {
    if (value == null) return;
    signals[name] = value;
    weighted += value * WEIGHTS[name];
    weightSum += WEIGHTS[name];
  };

  const type = typeCompatibility(deviceKind, prescriptionKind);
  add("type", type);

  const movingMin = activity.movingTimeSec / 60;
  add(
    "duration",
    candidate.durationMin && candidate.durationMin > 0
      ? proximity(movingMin, candidate.durationMin, 0.75)
      : null,
  );

  add(
    "timeOfDay",
    activity.localStartMinutes != null && candidate.localStartMinutes != null
      ? timeOfDayProximity(activity.localStartMinutes, candidate.localStartMinutes)
      : null,
  );

  const prescribedDistance =
    candidate.distanceMeters && candidate.distanceMeters > 0
      ? candidate.distanceMeters
      : parsePrescribedDistanceMeters(`${candidate.focus}\n${candidate.mainWorkout}`);
  add(
    "distance",
    prescribedDistance != null && activity.distanceMeters > 100
      ? proximity(activity.distanceMeters, prescribedDistance, 0.5)
      : null,
  );

  const overlap = nameOverlap(activity.name, `${candidate.focus} ${candidate.mainWorkout}`);
  // Only ever a bonus: a run called "Morning Run" tells us nothing about
  // which run it was, and its absence must not count against a candidate.
  add("name", overlap != null && overlap > 0 ? overlap : null);

  let score = weightSum > 0 ? weighted / weightSum : 0;
  // Damp incompatible types regardless of how well the numbers line up.
  if (type < TYPE_DAMPING_FLOOR) score *= type / TYPE_DAMPING_FLOOR;
  signals.total = score;

  return { candidate, score, signals };
}

export function rankCandidates(
  activity: DeviceActivityInput,
  candidates: readonly MatchCandidate[],
): CandidateScore[] {
  return candidates.map((c) => scoreCandidate(activity, c)).sort((a, b) => b.score - a.score);
}

export function decideMatch(
  activity: DeviceActivityInput,
  candidates: readonly MatchCandidate[],
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): MatchDecision {
  if (activity.movingTimeSec < MIN_MATCHABLE_MOVING_SEC) return { outcome: "none", score: null };
  const [best] = rankCandidates(activity, candidates);
  if (!best) return { outcome: "none", score: null };
  if (best.score >= thresholds.autoLink)
    return { outcome: "link", candidate: best.candidate, score: best.score };
  if (best.score >= thresholds.suggest)
    return { outcome: "suggest", candidate: best.candidate, score: best.score };
  return { outcome: "none", score: best.score };
}

// ── Batch assignment ────────────────────────────────────────────────────────

export interface PlannedMatch {
  activity: DeviceActivityInput;
  decision: MatchDecision;
}

/**
 * Decide every activity in a sync batch at once, one-to-one.
 *
 * A row can only hold one device activity, so when two activities on the same
 * day both score against the same plan day (a warm-up run and the session
 * itself), the better-scoring pair wins the link and the other is decided
 * against what remains. Greedy by descending score across the whole batch,
 * which is exact for the batch sizes a sync sees.
 *
 * Suggestions never claim a target — several may point at one row — but a
 * suggestion whose target was linked in this same batch is dropped, since the
 * link route would only refuse it.
 */
export function planDeviceActivityMatches(
  activities: readonly DeviceActivityInput[],
  candidatesByDate: ReadonlyMap<string, readonly MatchCandidate[]>,
  thresholds: MatchThresholds = DEFAULT_MATCH_THRESHOLDS,
): PlannedMatch[] {
  const decisions: MatchDecision[] = activities.map(() => ({ outcome: "none", score: null }));
  const pairs: Array<{ index: number; scored: CandidateScore }> = [];

  activities.forEach((activity, index) => {
    if (activity.movingTimeSec < MIN_MATCHABLE_MOVING_SEC) return;
    const candidates = candidatesByDate.get(activity.localDate) ?? [];
    for (const scored of rankCandidates(activity, candidates)) {
      if (scored.score >= thresholds.suggest) pairs.push({ index, scored });
    }
  });

  pairs.sort((a, b) => b.scored.score - a.scored.score);

  const claimed = new Set<string>();
  const decided = new Set<number>();
  const key = (c: MatchCandidate) => `${c.kind}:${c.id}`;

  for (const { index, scored } of pairs) {
    if (decided.has(index)) continue;
    if (scored.score >= thresholds.autoLink) {
      if (claimed.has(key(scored.candidate))) continue;
      claimed.add(key(scored.candidate));
      decisions[index] = { outcome: "link", candidate: scored.candidate, score: scored.score };
    } else {
      decisions[index] = { outcome: "suggest", candidate: scored.candidate, score: scored.score };
    }
    decided.add(index);
  }

  // Record the best score even for activities that matched nothing, so the
  // sync log can show how close a "none" came.
  activities.forEach((activity, index) => {
    if (decided.has(index)) return;
    const best = rankCandidates(activity, candidatesByDate.get(activity.localDate) ?? [])[0];
    decisions[index] = { outcome: "none", score: best?.score ?? null };
  });

  return activities.map((activity, index) => {
    const decision = decisions[index];
    if (decision.outcome === "suggest" && claimed.has(key(decision.candidate))) {
      return { activity, decision: { outcome: "none", score: decision.score } };
    }
    return { activity, decision };
  });
}
