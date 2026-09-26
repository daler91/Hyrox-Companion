/**
 * Load by body system: the shared vocabulary.
 *
 * The four systems, what each one covers, and the one sentence that says where
 * this week's load diverges from the athlete's usual week. Shared so the
 * Analytics card and the coach's prompt describe the same numbers in the same
 * words. The model itself lives server-side, in
 * server/services/trainingLoad/bodySystemLoad.ts.
 */
import type {
  BodySystem,
  BodySystemLoadOverview,
  BodySystemLoadSummary,
} from "./schema/types/analytics";

/** Display order everywhere: the engine, then the three tissues it drives. */
export const BODY_SYSTEMS = [
  "aerobic",
  "running_impact",
  "leg_muscle",
  "upper_pull",
] as const satisfies readonly BodySystem[];

export interface BodySystemMeta {
  /** Sentence-case name, for headings and table rows. */
  label: string;
  /** Lowercase name, for use inside a sentence. */
  noun: string;
  /** What the system is and what loads it. */
  description: string;
}

export const BODY_SYSTEM_META: Readonly<Record<BodySystem, BodySystemMeta>> = {
  aerobic: {
    label: "Aerobic",
    noun: "aerobic",
    description:
      "Heart and lungs. Running, ergs, bikes, swimming and conditioning load it most; lifting loads it a little.",
  },
  running_impact: {
    label: "Running impact",
    noun: "running impact",
    description:
      "Foot-strike load on bones, joints and tendons. Running, jumping and skipping; bikes, rowers and the SkiErg add none.",
  },
  leg_muscle: {
    label: "Leg muscle",
    noun: "leg muscle",
    description:
      "Quads, hamstrings, glutes and calves. Squats, hinges, lunges, sleds and wall balls, plus a share of every run and ride.",
  },
  upper_pull: {
    label: "Upper-body pull",
    noun: "upper-body pull",
    description:
      "Back, lats, biceps and grip. Rows, pull-ups, the SkiErg, sled pulls, rope climbs and carries.",
  },
};

/**
 * Whether any system carries any load in the six weeks shown. The Analytics
 * card renders on exactly this, and the AI surfaces that explain it use the
 * same test so they never describe a card the athlete cannot see.
 */
export function hasBodySystemLoadData(
  overview: Pick<BodySystemLoadOverview, "systems"> | null | undefined,
): boolean {
  return (
    overview?.systems.some((summary) =>
      summary.weekly.some((value) => value != null && value > 0),
    ) ?? false
  );
}

/**
 * Worth calling out: above the usual week, new against an empty one, or the
 * heaviest week in six. "Low" is not on this list — a lighter week is a
 * contrast to mention, not a warning.
 */
export function isNotableBodySystem(summary: BodySystemLoadSummary): boolean {
  return (
    summary.sixWeekHigh ||
    summary.status === "high" ||
    summary.status === "very_high" ||
    summary.status === "new"
  );
}

function percentChange(ratio: number): number {
  return Math.round((ratio - 1) * 100);
}

/**
 * A ratio to the usual week as a signed percentage: 1.31 → "+31%", 0.7 → "-30%".
 * Athletes read "31% above usual" faster than "1.31×", and the status label
 * next to it already carries the band.
 */
export function formatLoadChange(ratio: number): string {
  const pct = percentChange(ratio);
  return pct > 0 ? `+${pct}%` : `${pct}%`;
}

/** "a", "a and b", "a, b and c". */
function joinWithAnd(items: readonly string[]): string {
  const last = items.at(-1) ?? "";
  if (items.length <= 1) return last;
  return `${items.slice(0, -1).join(", ")} and ${last}`;
}

/** How far above the usual week, as "31% above your usual week", or null when not above it. */
function aboveUsual(ratio: number | null): string | null {
  if (ratio == null) return null;
  const pct = percentChange(ratio);
  return pct > 0 ? `${pct}% above your usual week` : null;
}

function notablePhrase(summary: BodySystemLoadSummary): string {
  const noun = BODY_SYSTEM_META[summary.system].noun;
  if (summary.status === "new") {
    return `${noun} load jumped from almost none in the previous four weeks`;
  }
  const above = aboveUsual(summary.ratio);
  if (summary.sixWeekHigh) {
    const detail = above ? ` (${above})` : "";
    return `${noun} load is at a six-week high${detail}`;
  }
  return `${noun} load is ${above ?? "above your usual week"}`;
}

function groupClause(systems: readonly BodySystemLoadSummary[], state: string): string {
  const nouns = joinWithAnd(systems.map((s) => BODY_SYSTEM_META[s.system].noun));
  return `${nouns} ${systems.length === 1 ? "load is" : "loads are"} ${state}`;
}

/**
 * The divergence the single overall number hides, in one sentence — or null
 * when no system stands out.
 *
 * "Leg muscle load is at a six-week high (31% above your usual week), while
 * aerobic and running impact loads are normal."
 *
 * The contrast clause names the systems that are normal or below usual, since
 * the point is the difference between systems, not the spike alone.
 */
export function describeBodySystemDivergence(
  overview: Pick<BodySystemLoadOverview, "systems">,
): string | null {
  const notable = overview.systems.filter(isNotableBodySystem);
  if (notable.length === 0) return null;

  const calm = overview.systems.filter((s) => !isNotableBodySystem(s));
  const normal = calm.filter((s) => s.status === "normal");
  const low = calm.filter((s) => s.status === "low");
  const contrast = [
    ...(normal.length > 0 ? [groupClause(normal, "normal")] : []),
    ...(low.length > 0 ? [groupClause(low, "below usual")] : []),
  ];

  const sentence =
    joinWithAnd(notable.map(notablePhrase)) +
    (contrast.length > 0 ? `, while ${joinWithAnd(contrast)}` : "");
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
