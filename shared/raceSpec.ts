/**
 * Canonical HYROX race specification + division/gender reference data, shared by
 * the client (Race Predictor tab) and server (race-prediction engine).
 *
 * A full HYROX race is a fixed 16-segment course: 8 × 1 km run legs interleaved
 * with the 8 functional stations in a fixed order. Station loads and competitive
 * benchmark split times differ by division (Open / Pro) and gender, which is why
 * the predictor needs both facts about the athlete.
 *
 * SEED DATA NOTE: loads marked ✅ in the plan were confirmed against multiple
 * public sources referencing the official 2025/26 singles rulebook; sled-pull
 * figures (⚠️) and every `benchmarkSeconds` / `runKmBenchmarkSeconds` value are
 * approximate seeds intended to be tuned in this one module. The AI estimation
 * layer refines them; the deterministic layer only falls back to them for
 * segments the athlete has not logged.
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

export interface StationStandard {
  /**
   * External load in kg: sled total (incl. sled) for sled push/pull, per-hand
   * weight for farmers carry, sandbag weight for lunges, ball weight for wall
   * balls. Undefined for erg/bodyweight stations (skierg, rowing, burpees).
   */
  loadKg?: number;
  /** Target reps where the station is rep-based (wall balls). */
  reps?: number;
  /** Station distance in meters (erg distance, carry/sled/lunge distance, burpee distance). */
  distanceMeters?: number;
  /** Approximate competitive split time in seconds — SEED, refined by AI. */
  benchmarkSeconds: number;
  /**
   * Fastest physically-plausible full-station split in seconds (≈ world-class).
   * A hard floor the predictor never goes below, so a mis-logged partial effort
   * (e.g. a short interval) can't surface as an elite-impossible split.
   */
  floorSeconds: number;
}

export interface RaceReference {
  /** Approximate per-1 km run split in seconds — SEED. */
  runKmBenchmarkSeconds: number;
  /** Fastest physically-plausible per-1 km run split in seconds (≈ world-class). */
  runKmFloorSeconds: number;
  stations: Record<HyroxStation, StationStandard>;
}

/** Fixed dimensions shared across all divisions (distance / reps). */
const STATION_DIMENSIONS: Record<HyroxStation, { reps?: number; distanceMeters?: number }> = {
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
 * (no external load).
 */
const STATION_LOADS_KG: Record<Division, Record<Gender, Partial<Record<HyroxStation, number>>>> = {
  open: {
    male: { sled_push: 152, sled_pull: 103 /* ⚠️ */, farmers_carry: 24, sandbag_lunges: 20, wall_balls: 6 },
    female: { sled_push: 102, sled_pull: 78 /* ⚠️ */, farmers_carry: 16, sandbag_lunges: 10, wall_balls: 4 },
  },
  pro: {
    male: { sled_push: 202, sled_pull: 153 /* ⚠️ */, farmers_carry: 32, sandbag_lunges: 30, wall_balls: 9 },
    female: { sled_push: 152, sled_pull: 103 /* ⚠️ */, farmers_carry: 24, sandbag_lunges: 20, wall_balls: 6 },
  },
};

/** Approximate per-station split seconds by division + gender — SEED, AI refines. */
const STATION_BENCHMARK_SECONDS: Record<Division, Record<Gender, Record<HyroxStation, number>>> = {
  open: {
    male: {
      skierg: 270, sled_push: 200, sled_pull: 220, burpee_broad_jump: 280,
      rowing: 255, farmers_carry: 140, sandbag_lunges: 280, wall_balls: 360,
    },
    female: {
      skierg: 300, sled_push: 230, sled_pull: 240, burpee_broad_jump: 320,
      rowing: 285, farmers_carry: 160, sandbag_lunges: 320, wall_balls: 420,
    },
  },
  pro: {
    male: {
      skierg: 255, sled_push: 220, sled_pull: 230, burpee_broad_jump: 260,
      rowing: 240, farmers_carry: 135, sandbag_lunges: 290, wall_balls: 360,
    },
    female: {
      skierg: 285, sled_push: 240, sled_pull: 245, burpee_broad_jump: 300,
      rowing: 270, farmers_carry: 150, sandbag_lunges: 310, wall_balls: 400,
    },
  },
};

/** Approximate per-km run split seconds by division + gender — SEED. */
const RUN_KM_BENCHMARK_SECONDS: Record<Division, Record<Gender, number>> = {
  open: { male: 330, female: 372 }, // ~5:30 / ~6:12 per km (fatigued, mid-pack)
  pro: { male: 270, female: 300 }, // ~4:30 / ~5:00 per km (competitive)
};

/**
 * Fastest physically-plausible full-station split seconds (≈ world-class). These
 * are deliberately set at the edge of human possibility and are gender/division
 * agnostic, so they only ever clamp impossible values (e.g. a partial-interval
 * log mistaken for a full station) — never a merely fast, legitimate athlete.
 */
const STATION_FLOOR_SECONDS: Record<HyroxStation, number> = {
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
const RUN_KM_FLOOR_SECONDS = 165; // 2:45 / km

function buildReference(division: Division, gender: Gender): RaceReference {
  const stations = {} as Record<HyroxStation, StationStandard>;
  for (const station of HYROX_STATION_ORDER) {
    stations[station] = {
      ...STATION_DIMENSIONS[station],
      loadKg: STATION_LOADS_KG[division][gender][station],
      benchmarkSeconds: STATION_BENCHMARK_SECONDS[division][gender][station],
      floorSeconds: STATION_FLOOR_SECONDS[station],
    };
  }
  return {
    runKmBenchmarkSeconds: RUN_KM_BENCHMARK_SECONDS[division][gender],
    runKmFloorSeconds: RUN_KM_FLOOR_SECONDS,
    stations,
  };
}

export const RACE_REFERENCE: Record<Division, Record<Gender, RaceReference>> = {
  open: { male: buildReference("open", "male"), female: buildReference("open", "female") },
  pro: { male: buildReference("pro", "male"), female: buildReference("pro", "female") },
};

export function getRaceReference(division: Division, gender: Gender): RaceReference {
  return RACE_REFERENCE[division][gender];
}

/**
 * Neutral reference for an athlete who withheld gender: benchmark times are the
 * mean of male/female, while loads use the male (heavier) standard so the
 * prediction stays conservative rather than optimistic.
 */
function buildBlendedReference(division: Division): RaceReference {
  const m = RACE_REFERENCE[division].male;
  const f = RACE_REFERENCE[division].female;
  const stations = {} as Record<HyroxStation, StationStandard>;
  for (const station of HYROX_STATION_ORDER) {
    stations[station] = {
      ...STATION_DIMENSIONS[station],
      loadKg: m.stations[station].loadKg,
      benchmarkSeconds: Math.round((m.stations[station].benchmarkSeconds + f.stations[station].benchmarkSeconds) / 2),
      floorSeconds: m.stations[station].floorSeconds,
    };
  }
  return {
    runKmBenchmarkSeconds: Math.round((m.runKmBenchmarkSeconds + f.runKmBenchmarkSeconds) / 2),
    runKmFloorSeconds: m.runKmFloorSeconds,
    stations,
  };
}

export interface ResolvedRaceReference {
  division: Division;
  /** Resolved gender used for load standards, or null when the athlete withheld it. */
  resolvedGender: Gender | null;
  /** True when gender was unanswered/withheld and a neutral fallback was used. */
  genderAssumed: boolean;
  reference: RaceReference;
}

/**
 * Resolve the reference table for a stored athlete profile, normalizing loose
 * division/gender strings and handling the withheld-gender case with a blended
 * fallback + an `genderAssumed` flag the UI can surface.
 */
export function resolveRaceReference(
  division: string | null | undefined,
  storedGender: StoredGender,
): ResolvedRaceReference {
  const div: Division = division === "pro" ? "pro" : "open";
  if (storedGender === "male" || storedGender === "female") {
    return {
      division: div,
      resolvedGender: storedGender,
      genderAssumed: false,
      reference: RACE_REFERENCE[div][storedGender],
    };
  }
  return {
    division: div,
    resolvedGender: null,
    genderAssumed: true,
    reference: buildBlendedReference(div),
  };
}
