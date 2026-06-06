/**
 * Data-independent HYROX race facts: the fixed 16-segment course, station order,
 * rulebook loads/dimensions, world-class floors, and age-band helpers.
 *
 * None of this is derived from any dataset, so the offline benchmark tool
 * (script/race-benchmarks) can import it WITHOUT pulling in the generated
 * benchmark artifact. That breaks both the import cycle (raceSpec → generated
 * artifact → …) and the first-run bootstrap (the artifact does not exist until
 * the tool emits it).
 *
 * shared/raceSpec.ts re-exports everything here, so existing `@shared/raceSpec`
 * importers are unaffected.
 */
import { EXERCISE_DEFINITIONS, type ExerciseName } from "./schema/exercises";

export type Division = "open" | "pro";
/** Gender resolved for standards/benchmarks (HYROX defines two categories). */
export type Gender = "male" | "female";
/** Gender as stored on the user row — withheld/unanswered is allowed. */
export type StoredGender = "male" | "female" | "prefer_not_to_say" | null | undefined;

export type RaceSegmentKind = "run" | "station";

/** The 8 functional stations — a subset of the canonical exercise keys. */
export type HyroxStation =
  | "skierg"
  | "sled_push"
  | "sled_pull"
  | "burpee_broad_jump"
  | "rowing"
  | "farmers_carry"
  | "sandbag_lunges"
  | "wall_balls";

/** Stations in race order. */
export const HYROX_STATION_ORDER: readonly HyroxStation[] = [
  "skierg",
  "sled_push",
  "sled_pull",
  "burpee_broad_jump",
  "rowing",
  "farmers_carry",
  "sandbag_lunges",
  "wall_balls",
] as const;

/** Canonical exercise key for a 1 km race run leg. */
export const RUN_EXERCISE_NAME: ExerciseName = "run_1k";
export const RUN_LEG_DISTANCE_METERS = 1000;
export const RACE_RUN_LEGS = HYROX_STATION_ORDER.length; // 8 runs (one before each station)
export const TOTAL_STATIONS = HYROX_STATION_ORDER.length; // 8

export interface RaceSegment {
  /** 1-based position in the race (1..16). */
  index: number;
  kind: RaceSegmentKind;
  exerciseName: ExerciseName;
  label: string;
}

function buildSegments(): RaceSegment[] {
  // Each station contributes a run then the station itself, so segment indices
  // interleave 1..16 as run(1), station(2), run(3), station(4), …
  return HYROX_STATION_ORDER.flatMap((station, i): RaceSegment[] => [
    {
      index: 2 * i + 1,
      kind: "run",
      exerciseName: RUN_EXERCISE_NAME,
      label: `Run ${i + 1}`,
    },
    {
      index: 2 * i + 2,
      kind: "station",
      exerciseName: station,
      label: EXERCISE_DEFINITIONS[station].label,
    },
  ]);
}

/** The full ordered 16-segment course (run, station, run, station, …). */
export const RACE_SEGMENTS: readonly RaceSegment[] = buildSegments();

/** Fixed dimensions shared across all divisions (distance / reps). */
export const STATION_DIMENSIONS: Record<HyroxStation, { reps?: number; distanceMeters?: number }> =
  {
    skierg: { distanceMeters: 1000 },
    sled_push: { distanceMeters: 50 },
    sled_pull: { distanceMeters: 50 },
    burpee_broad_jump: { distanceMeters: 80 },
    rowing: { distanceMeters: 1000 },
    farmers_carry: { distanceMeters: 200 },
    sandbag_lunges: { distanceMeters: 100 },
    wall_balls: { reps: 100 },
  };

/**
 * External loads (kg) by division + gender. ✅ confirmed except sled_pull (⚠️
 * verify against the official rulebook). Erg/bodyweight stations are omitted
 * (no external load). These are rulebook facts, not derivable from result times.
 */
export const STATION_LOADS_KG: Record<
  Division,
  Record<Gender, Partial<Record<HyroxStation, number>>>
> = {
  open: {
    male: {
      sled_push: 152,
      sled_pull: 103 /* ⚠️ */,
      farmers_carry: 24,
      sandbag_lunges: 20,
      wall_balls: 6,
    },
    female: {
      sled_push: 102,
      sled_pull: 78 /* ⚠️ */,
      farmers_carry: 16,
      sandbag_lunges: 10,
      wall_balls: 4,
    },
  },
  pro: {
    male: {
      sled_push: 202,
      sled_pull: 153 /* ⚠️ */,
      farmers_carry: 32,
      sandbag_lunges: 30,
      wall_balls: 9,
    },
    female: {
      sled_push: 152,
      sled_pull: 103 /* ⚠️ */,
      farmers_carry: 24,
      sandbag_lunges: 20,
      wall_balls: 6,
    },
  },
};

/**
 * Fastest physically-plausible full-station split seconds (≈ world-class). These
 * are deliberately set at the edge of human possibility and are gender/division
 * agnostic, so they only ever clamp impossible values (e.g. a partial-interval
 * log mistaken for a full station, or a mis-recorded result row) — never a
 * merely fast, legitimate athlete.
 */
export const STATION_FLOOR_SECONDS: Record<HyroxStation, number> = {
  skierg: 180, // 3:00 / 1000 m
  sled_push: 60,
  sled_pull: 50,
  burpee_broad_jump: 150,
  rowing: 165, // 2:45 / 1000 m
  farmers_carry: 50,
  sandbag_lunges: 100,
  wall_balls: 150, // 2:30 / 100 reps
};

/** Fastest physically-plausible per-1 km run split in seconds (≈ world-class). */
export const RUN_KM_FLOOR_SECONDS = 165; // 2:45 / km

// --- Age-band helpers -------------------------------------------------------
// Shared by the offline benchmark tool (normalizing the dataset's many
// age-group label schemes) and the runtime resolver (mapping an athlete's age
// to a cohort), so both agree on the exact canonical bands.

/** Canonical 5-year age bands the benchmark cohorts are keyed by. */
export const CANONICAL_AGE_BANDS = [
  "16-24",
  "25-29",
  "30-34",
  "35-39",
  "40-44",
  "45-49",
  "50-54",
  "55-59",
  "60-64",
  "65-69",
  "70-74",
  "75-79",
  "80-84",
] as const;
export type AgeBand = (typeof CANONICAL_AGE_BANDS)[number];

const CANONICAL_AGE_SET = new Set<string>(CANONICAL_AGE_BANDS);

/**
 * Normalize a raw dataset `age_group` label to a canonical 5-year band, or null
 * when it is blank, a coarse/overlapping scheme (e.g. "30-39", "U40", "16-29"),
 * or a junk/format code. Null-mapped rows still feed the division×gender
 * roll-up; only exact 5-year bands form age-specific cohorts.
 */
export function normalizeAgeGroup(raw: string | null | undefined): AgeBand | null {
  if (!raw) return null;
  const m = /(\d{2})\s*-\s*(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const band = `${m[1]}-${m[2]}`;
  return CANONICAL_AGE_SET.has(band) ? (band as AgeBand) : null;
}

/** Map an athlete's age to its canonical 5-year band (16-24 floor, 80-84 cap). */
export function deriveAgeGroupFromAge(age: number | null | undefined): AgeBand | null {
  if (age == null || !Number.isFinite(age) || age < 16) return null;
  if (age <= 24) return "16-24";
  if (age >= 80) return "80-84";
  const lower = Math.floor((age - 25) / 5) * 5 + 25; // 25→25, 29→25, 30→30, 44→40…
  const band = `${lower}-${lower + 4}`;
  return CANONICAL_AGE_SET.has(band) ? (band as AgeBand) : null;
}

/** Stable lookup key for a benchmark/ranking cohort. */
export function cohortKey(division: Division, gender: Gender, ageGroup?: string | null): string {
  return ageGroup ? `${division}|${gender}|${ageGroup}` : `${division}|${gender}`;
}
