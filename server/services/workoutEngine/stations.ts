/**
 * HYROX station doses by phase, loaded from the athlete's own race standard.
 *
 * A station is trained the way a lift is: heavier and shorter early (sled
 * strength, carry strength), at race load in broken race distances through
 * the build, at full race distance and straight off a run in the peak, and
 * short and sharp in the taper. Anchoring every load to the division's
 * rulebook weight is what turns "sled push, heavy" into "5 x 12.5 m @ 180 kg"
 * — and makes the dose right for a Pro man and an Open woman alike.
 */
import type { TrainingPhase } from "@shared/nutritionTargets";
import { HYROX_STATION_ORDER, type HyroxStation, STATION_LOADS_KG } from "@shared/raceConstants";
import { convertWeight, type WeightUnit } from "@shared/unitConversion";

export interface StationDose {
  readonly station: HyroxStation;
  readonly sets: number;
  readonly distanceMeters?: number;
  readonly reps?: number;
  /** Fraction of the race load; absent for unloaded stations (ergs, burpees). */
  readonly loadFraction?: number;
  /** The load in the athlete's unit, when their race standard is known. */
  readonly load?: number;
  readonly restSec: number;
  readonly cue: string;
}

export interface StationPhasePlan {
  readonly phase: TrainingPhase;
  /** What station work is for in this phase, in one line. */
  readonly intent: string;
  readonly doses: readonly StationDose[];
}

type DoseTemplate = Omit<StationDose, "station" | "load">;

const PHASE_INTENT: Readonly<Record<TrainingPhase, string>> = {
  early:
    "strength-biased: heavier than race load over short distances, perfect mechanics, full recovery",
  build: "race load over broken race distances, shortening the rests week to week",
  peak: "full race distance at race load, straight off a 1 km run (compromised), race pacing",
  taper: "short and sharp at race load — about half the build volume, nothing to failure",
  race_week: "openers only: a few short efforts at race load early in the week",
};

const DOSES: Readonly<Record<TrainingPhase, Readonly<Record<HyroxStation, DoseTemplate>>>> = {
  early: {
    skierg: {
      sets: 6,
      distanceMeters: 250,
      restSec: 60,
      cue: "strong even splits, long pulls from the lats",
    },
    sled_push: {
      sets: 5,
      distanceMeters: 12.5,
      loadFraction: 1.2,
      restSec: 120,
      cue: "low hips, short fast steps, arms locked",
    },
    sled_pull: {
      sets: 5,
      distanceMeters: 12.5,
      loadFraction: 1.1,
      restSec: 120,
      cue: "sit low, long hand-over-hand pulls, no slack",
    },
    burpee_broad_jump: {
      sets: 4,
      reps: 8,
      restSec: 60,
      cue: "step back, jump both feet, land soft and go",
    },
    rowing: {
      sets: 6,
      distanceMeters: 250,
      restSec: 60,
      cue: "legs, then back, then arms; strong finish",
    },
    farmers_carry: {
      sets: 4,
      distanceMeters: 50,
      loadFraction: 1.25,
      restSec: 90,
      cue: "tall posture, quick steps, crush the handles",
    },
    sandbag_lunges: {
      sets: 3,
      distanceMeters: 20,
      loadFraction: 1,
      restSec: 90,
      cue: "back knee touches every rep, torso upright",
    },
    wall_balls: {
      sets: 5,
      reps: 15,
      loadFraction: 1,
      restSec: 60,
      cue: "full squat depth, hit the target every rep",
    },
  },
  build: {
    skierg: { sets: 4, distanceMeters: 500, restSec: 90, cue: "race pace, hold the split" },
    sled_push: {
      sets: 4,
      distanceMeters: 25,
      loadFraction: 1,
      restSec: 90,
      cue: "no stops inside a length",
    },
    sled_pull: {
      sets: 4,
      distanceMeters: 25,
      loadFraction: 1,
      restSec: 90,
      cue: "rhythm over speed, walk back quickly",
    },
    burpee_broad_jump: {
      sets: 4,
      distanceMeters: 20,
      restSec: 60,
      cue: "steady cadence you could hold for 80 m",
    },
    rowing: { sets: 4, distanceMeters: 500, restSec: 90, cue: "race pace, 26-30 strokes a minute" },
    farmers_carry: {
      sets: 4,
      distanceMeters: 100,
      loadFraction: 1,
      restSec: 60,
      cue: "unbroken, no set-downs",
    },
    sandbag_lunges: {
      sets: 4,
      distanceMeters: 25,
      loadFraction: 1,
      restSec: 60,
      cue: "steady rhythm, no rests mid-set",
    },
    wall_balls: {
      sets: 4,
      reps: 25,
      loadFraction: 1,
      restSec: 60,
      cue: "unbroken sets, breathe at the top",
    },
  },
  peak: {
    skierg: {
      sets: 2,
      distanceMeters: 1000,
      restSec: 180,
      cue: "race pace straight off a 1 km run",
    },
    sled_push: {
      sets: 2,
      distanceMeters: 50,
      loadFraction: 1,
      restSec: 180,
      cue: "full race distance off a 1 km run",
    },
    sled_pull: {
      sets: 2,
      distanceMeters: 50,
      loadFraction: 1,
      restSec: 180,
      cue: "full race distance off a 1 km run",
    },
    burpee_broad_jump: {
      sets: 2,
      distanceMeters: 40,
      restSec: 120,
      cue: "race rhythm, no pauses on the floor",
    },
    rowing: {
      sets: 2,
      distanceMeters: 1000,
      restSec: 180,
      cue: "race pace straight off a 1 km run",
    },
    farmers_carry: {
      sets: 2,
      distanceMeters: 200,
      loadFraction: 1,
      restSec: 120,
      cue: "race distance unbroken",
    },
    sandbag_lunges: {
      sets: 2,
      distanceMeters: 50,
      loadFraction: 1,
      restSec: 120,
      cue: "race rhythm, one breath per step",
    },
    wall_balls: {
      sets: 2,
      reps: 50,
      loadFraction: 1,
      restSec: 120,
      cue: "planned sets (e.g. 20-15-15), short rests",
    },
  },
  taper: {
    skierg: { sets: 3, distanceMeters: 250, restSec: 90, cue: "race pace, relaxed" },
    sled_push: {
      sets: 3,
      distanceMeters: 12.5,
      loadFraction: 1,
      restSec: 120,
      cue: "crisp, fast feet",
    },
    sled_pull: {
      sets: 3,
      distanceMeters: 12.5,
      loadFraction: 1,
      restSec: 120,
      cue: "crisp, fast hands",
    },
    burpee_broad_jump: { sets: 2, distanceMeters: 10, restSec: 60, cue: "smooth and quick" },
    rowing: { sets: 3, distanceMeters: 250, restSec: 90, cue: "race pace, relaxed" },
    farmers_carry: {
      sets: 2,
      distanceMeters: 50,
      loadFraction: 1,
      restSec: 60,
      cue: "fast, tall, easy grip",
    },
    sandbag_lunges: {
      sets: 2,
      distanceMeters: 20,
      loadFraction: 1,
      restSec: 60,
      cue: "smooth rhythm",
    },
    wall_balls: {
      sets: 3,
      reps: 15,
      loadFraction: 1,
      restSec: 60,
      cue: "unbroken, well within yourself",
    },
  },
  race_week: {
    skierg: { sets: 2, distanceMeters: 200, restSec: 90, cue: "race pace, stop fresh" },
    sled_push: {
      sets: 2,
      distanceMeters: 10,
      loadFraction: 1,
      restSec: 120,
      cue: "feel the race weight, stop fresh",
    },
    sled_pull: {
      sets: 2,
      distanceMeters: 10,
      loadFraction: 1,
      restSec: 120,
      cue: "feel the race weight, stop fresh",
    },
    burpee_broad_jump: { sets: 1, distanceMeters: 10, restSec: 60, cue: "rehearse the rhythm" },
    rowing: { sets: 2, distanceMeters: 200, restSec: 90, cue: "race pace, stop fresh" },
    farmers_carry: {
      sets: 1,
      distanceMeters: 50,
      loadFraction: 1,
      restSec: 60,
      cue: "rehearse the grip",
    },
    sandbag_lunges: {
      sets: 1,
      distanceMeters: 10,
      loadFraction: 1,
      restSec: 60,
      cue: "rehearse the rhythm",
    },
    wall_balls: { sets: 2, reps: 10, loadFraction: 1, restSec: 60, cue: "rehearse the rhythm" },
  },
};

/** Real implement steps for each loaded station, in kg. */
const LOAD_STEP_KG: Readonly<Partial<Record<HyroxStation, number>>> = {
  sled_push: 5,
  sled_pull: 5,
  farmers_carry: 2,
  sandbag_lunges: 5,
  wall_balls: 1,
};
const LOAD_STEP_LBS: Readonly<Partial<Record<HyroxStation, number>>> = {
  sled_push: 10,
  sled_pull: 10,
  farmers_carry: 5,
  sandbag_lunges: 5,
  wall_balls: 2,
};

function stationLoad(
  station: HyroxStation,
  fraction: number | undefined,
  raceKg: number | undefined,
  unit: WeightUnit,
): number | undefined {
  if (fraction == null || raceKg == null) return undefined;
  const value = convertWeight(raceKg * fraction, "kg", unit);
  // At race load, the rulebook number itself (152 kg, not the nearest plate
  // below it): the athlete should rehearse exactly what they will race.
  if (fraction === 1) return unit === "lbs" ? Math.round(value) : Math.round(value * 2) / 2;
  const step = (unit === "lbs" ? LOAD_STEP_LBS : LOAD_STEP_KG)[station] ?? 1;
  return Math.max(step, Math.round(value / step) * step);
}

export interface StationPlanInput {
  readonly division?: string | null;
  readonly gender?: string | null;
  readonly unit: WeightUnit;
  /** Stations the athlete cannot train (equipment, constraints). */
  readonly excluded?: ReadonlySet<string>;
}

/**
 * The station doses for one phase. Loads are filled in only when the athlete's
 * gender is known — without it, the race standard itself is ambiguous and the
 * dose stays a fraction of race load, which the brief's standards line spells
 * out for both categories.
 */
export function buildStationPhasePlan(
  phase: TrainingPhase,
  input: StationPlanInput,
): StationPhasePlan {
  const division = input.division === "pro" ? "pro" : "open";
  const loads =
    input.gender === "male" || input.gender === "female"
      ? STATION_LOADS_KG[division][input.gender]
      : null;
  const doses = HYROX_STATION_ORDER.filter((station) => !input.excluded?.has(station)).map(
    (station): StationDose => {
      const template = DOSES[phase][station];
      const load = stationLoad(station, template.loadFraction, loads?.[station], input.unit);
      return { station, ...template, ...(load == null ? {} : { load }) };
    },
  );
  return { phase, intent: PHASE_INTENT[phase], doses };
}
