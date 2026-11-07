/**
 * shared/unitConversion.ts: the 19 functions the app ports to Kotlin
 * (mobile/core/.../units/UnitConversion.kt), listed in
 * docs/mobile-shared-logic.md.
 *
 * Unit arguments are raw strings, null where the Kotlin port takes a null.
 * The TS typing says `string` for most of them, but every one goes through
 * a `standardize*` call that treats a falsy unit as missing, so null is
 * cast through rather than left out.
 *
 * One TS quirk is pinned on purpose: the alias tables are plain objects, so
 * "constructor" and "__proto__" (after lowercasing and trimming) resolve to
 * inherited Object.prototype members. Where the TS then returns such a
 * member instead of a unit, or throws a TypeError calling toLowerCase on
 * it, the output is NOT_A_UNIT and the port throws UnitAliasException.
 * Everywhere else the output is whatever the TS computes with it.
 */
import {
  cmToFtIn,
  convertWeight,
  displayDistanceToStored,
  ftInToCm,
  getStoredDistanceUnit,
  getWorkoutDistanceDisplay,
  kgToUserWeight,
  metersToUserDistance,
  restampSetPatch,
  roundStoredDistance,
  roundStoredWeight,
  stampForPreferences,
  standardizeDistanceUnit,
  standardizeParsedDistanceUnit,
  standardizeWeightUnit,
  storedDistanceToDisplay,
  type StoredUnitStamp,
  storedWeightToDisplay,
  type UnitPreferences,
  userDistanceToMeters,
  userWeightToKg,
  type WorkoutDistanceDisplayUnit,
} from "../../../shared/unitConversion";
import { suite } from "../types";

type Unit = string | null;

/** Output for "the TS yields no unit here"; the Kotlin port throws UnitAliasException. */
const NOT_A_UNIT = { notAUnit: true } as const;
type NotAUnit = typeof NOT_A_UNIT;

/** The TS functions take `string`, but treat null like any falsy unit. */
function raw(unit: Unit): string {
  return unit as string;
}

/** A unit the TS returned, or NOT_A_UNIT when it returned an inherited Object.prototype member. */
function unitOrNotAUnit<T>(value: T): T | NotAUnit {
  return typeof value === "string" || value === null ? value : NOT_A_UNIT;
}

/** Runs [run], mapping the TypeError the TS throws on an inherited member to NOT_A_UNIT. */
function orNotAUnit<T>(run: () => T): T | NotAUnit {
  try {
    return run();
  } catch (error) {
    if (error instanceof TypeError) return NOT_A_UNIT;
    throw error;
  }
}

/** Deterministic pseudo-random doubles (the fixed LCG of js.ts), so the fixture never changes on its own. */
function seeded(count: number, scale: number, seed: number): number[] {
  let state = seed >>> 0;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push((state / 2 ** 32 - 0.5) * 2 * scale);
  }
  return out;
}

/** Every spelling class the standardize* functions distinguish, plus JS-specific trim / case / prototype edges. */
const UNIT_SPELLINGS: Unit[] = [
  null,
  "",
  " ",
  "KG",
  "kg",
  "kgs",
  "kilo",
  "kilos",
  "kilogram",
  "Kilograms",
  " lbs ",
  "lb",
  "LBS",
  "Pound",
  "pounds",
  "stone",
  "stones",
  "mi",
  "MI",
  "mile",
  "Miles",
  "km",
  "KMS",
  "kilometer",
  "kilometers",
  "kilometre",
  "Kilometres",
  "m",
  "M",
  "meter",
  "meters",
  "metre",
  "metres",
  "ft",
  "FT",
  "foot",
  "feet",
  "yards",
  "k g",
  "kg.",
  // String.prototype.trim strips these (JS WhiteSpace / LineTerminator) ...
  "\tLBS\n",
  "\u000Bmiles\u000C",
  "\u00A0lbs\u3000",
  "\uFEFFlbs",
  "\uFEFFmi",
  "\uFEFFft",
  "\u2028mi\u2029",
  "\u1680m\u205F",
  // ... and not these (Kotlin's trim() strips U+001C..U+001F).
  "\u001Clbs",
  "\u001Fmi",
  "\u001Cft",
  "\u0085lbs",
  "\u200Blbs",
  "\u180Emi",
  // toLowerCase maps KELVIN SIGN to "k".
  "\u212Am",
  "\u212AMS",
  "\u212AG",
  // Plain-object lookups: only all-lowercase Object.prototype members can match.
  "constructor",
  " Constructor ",
  "__proto__",
  "__PROTO__",
  "toString",
  "tostring",
  "hasOwnProperty",
  "valueOf",
  "prototype",
];

const ODD_NUMBERS = [Number.NaN, Infinity, -Infinity, 1e308, -1e308, 5e-324, 1e-300];

const KG_ATHLETE: UnitPreferences = { weightUnit: "kg", distanceUnit: "km" };
const LB_ATHLETE: UnitPreferences = { weightUnit: "lbs", distanceUnit: "miles" };

interface StampedInput {
  value: number;
  stamp: StoredUnitStamp;
  preferences: UnitPreferences;
}

interface RestampExisting {
  weight?: number | null;
  plannedWeight?: number | null;
  distance?: number | null;
  plannedDistance?: number | null;
  weightUnit?: string | null;
  distanceUnit?: string | null;
}

interface RestampPatch extends RestampExisting {
  reps?: number | null;
  notes?: string | null;
}

interface RestampInput {
  existing: RestampExisting;
  patch: RestampPatch;
  preferences: UnitPreferences;
}

export const unitConversionSuites = [
  suite({
    name: "unitConversion.standardizeWeightUnit",
    description: "A weight unit spelling to kg or lbs; null, empty and unknown are kg.",
    run: (unit: Unit) => unitOrNotAUnit(standardizeWeightUnit(unit)),
    cases: UNIT_SPELLINGS,
  }),
  suite({
    name: "unitConversion.standardizeDistanceUnit",
    description: "A distance preference spelling to km or miles; null, empty, unknown, m, ft and kilometre are km.",
    run: (unit: Unit) => unitOrNotAUnit(standardizeDistanceUnit(unit)),
    cases: UNIT_SPELLINGS,
  }),
  suite({
    name: "unitConversion.standardizeParsedDistanceUnit",
    description: "A distance spelling to m, ft, km or miles; null for null, empty and unknown.",
    run: (unit: Unit) => unitOrNotAUnit(standardizeParsedDistanceUnit(unit)),
    cases: UNIT_SPELLINGS,
  }),
  suite({
    name: "unitConversion.getStoredDistanceUnit",
    description: "The stored distance unit for a preference: ft for miles, m for anything else (ft is not a preference).",
    run: (unit: Unit) => getStoredDistanceUnit(unit),
    cases: UNIT_SPELLINGS,
  }),
  suite({
    name: "unitConversion.convertWeight",
    description: "Weight between two unit spellings, unrounded; identity for the same unit or an inherited-member spelling.",
    run: ([value, from, to]: [number, Unit, Unit]) => convertWeight(value, raw(from), raw(to)),
    cases: [
      [100, "kg", "lbs"],
      [220.462, "lbs", "kg"],
      [0, "kg", "lbs"],
      [-5, "kg", "lbs"],
      [100, "kg", "stone"],
      [100, "KG", "Pounds"],
      [100, "kg", "kg"],
      [100, "lbs", "lbs"],
      [100, " lb ", "LBS"],
      [100, "stone", "lbs"],
      [100, "lbs", "stone"],
      [0.1, "lb", "kgs"],
      [1 / 3, "kg", "lbs"],
      [100, null, "lbs"],
      [100, "lbs", null],
      [100, "", "lbs"],
      [100, null, null],
      [100, "constructor", "lbs"],
      [100, "lbs", "constructor"],
      [100, "kg", "__proto__"],
      [100, "constructor", "constructor"],
      [100, "constructor", "__proto__"],
      ...ODD_NUMBERS.flatMap((x): [number, Unit, Unit][] => [
        [x, "kg", "lbs"],
        [x, "lbs", "kg"],
      ]),
    ],
  }),
  suite({
    name: "unitConversion.kgToUserWeight",
    description: "Kilograms in the athlete's weight unit, unrounded.",
    run: ([kg, unit]: [number, Unit]) => kgToUserWeight(kg, raw(unit)),
    cases: [
      ...[70, 154.3, 0.1, 500, 0, -70].flatMap((kg): [number, Unit][] => [
        [kg, "kg"],
        [kg, "lbs"],
      ]),
      [70, "pounds"],
      [70, null],
      [70, "stone"],
      [70, "constructor"],
      [70, "__proto__"],
      ...ODD_NUMBERS.map((x): [number, Unit] => [x, "lbs"]),
    ],
  }),
  suite({
    name: "unitConversion.userWeightToKg",
    description: "A weight in the athlete's unit in kilograms, unrounded.",
    run: ([value, unit]: [number, Unit]) => userWeightToKg(value, raw(unit)),
    cases: [
      ...[70, 154.3, 0.1, 500, 0, -70].flatMap((value): [number, Unit][] => [
        [value, "kg"],
        [value, "lbs"],
      ]),
      [154.3, "LB"],
      [154.3, null],
      [154.3, "stone"],
      [154.3, "constructor"],
      [154.3, "__proto__"],
      ...ODD_NUMBERS.map((x): [number, Unit] => [x, "lbs"]),
    ],
  }),
  suite({
    name: "unitConversion.metersToUserDistance",
    description: "Metres in km or miles, unrounded; an inherited-member spelling matches neither and returns the metres.",
    run: ([meters, unit]: [number, Unit]) => metersToUserDistance(meters, raw(unit)),
    cases: [
      [5000, "km"],
      [1609.344, "miles"],
      [42195, "miles"],
      [0, "km"],
      [-100, "km"],
      [42195, "km"],
      [5000, "mi"],
      [5000, " Mile "],
      [5000, null],
      [5000, ""],
      [5000, "m"],
      [5000, "feet"],
      [5000, "kilometre"],
      [5000, "constructor"],
      [5000, "__proto__"],
      [0.001, "miles"],
      ...ODD_NUMBERS.flatMap((x): [number, Unit][] => [
        [x, "km"],
        [x, "miles"],
      ]),
    ],
  }),
  suite({
    name: "unitConversion.userDistanceToMeters",
    description: "A distance in km or miles in metres, as (value / KM_TO_MILES) * 1000 for miles.",
    run: ([value, unit]: [number, Unit]) => userDistanceToMeters(value, raw(unit)),
    cases: [
      [1, "miles"],
      [26.2, "miles"],
      [5, "km"],
      [0.1, "km"],
      [0, "miles"],
      [-3, "miles"],
      [-3, "km"],
      [13.1, "mi"],
      [1, null],
      [1, "m"],
      [1, "constructor"],
      [1, "__proto__"],
      ...seeded(20, 100, 5).map((x): [number, Unit] => [x, "miles"]),
      ...ODD_NUMBERS.flatMap((x): [number, Unit][] => [
        [x, "km"],
        [x, "miles"],
      ]),
    ],
  }),
  suite({
    name: "unitConversion.cmToFtIn",
    description: "Centimetres to whole feet and inches: Math.round to the inch, then Math.floor and JS % (negative heights keep the sign).",
    run: (cm: number) => cmToFtIn(cm),
    cases: [
      180,
      182.88,
      152.4,
      0,
      1.27,
      3.81,
      -2.54,
      -1.27,
      29.21,
      175,
      200,
      250.19,
      30.48,
      -30.48,
      -31.75,
      -33.02,
      0.0001,
      1e10,
      ...seeded(30, 250, 9),
      ...ODD_NUMBERS,
    ],
  }),
  suite({
    name: "unitConversion.ftInToCm",
    description: "Feet and inches to centimetres, unrounded.",
    run: ([feet, inches]: [number, number]) => ftInToCm(feet, inches),
    cases: [
      [5, 11],
      [6, 0],
      [0, 0],
      [5, 12],
      [5, 11.5],
      [5.5, 0],
      [-1, -1],
      [0, -3],
      [Number.NaN, 0],
      [0, Infinity],
      [1e308, 0],
      [Infinity, -Infinity],
    ],
  }),
  suite({
    name: "unitConversion.roundStoredWeight",
    description: "Whole pounds for lbs, nearest half otherwise, halves up (Math.round); NaN and infinities pass through.",
    run: ([value, unit]: [number, Unit]) => roundStoredWeight(value, raw(unit)),
    cases: [
      [102.25, "kg"],
      [102.24, "kg"],
      [-2.25, "kg"],
      [221.5, "lbs"],
      [-0.5, "lbs"],
      [Number.NaN, "kg"],
      [Infinity, "kg"],
      [102.75, "kg"],
      [-2.75, "kg"],
      [0.25, "kg"],
      [-0.25, "kg"],
      [221.49, "lbs"],
      [-221.5, "lbs"],
      [0.49999999999999994, "lbs"],
      [4503599627370495.5, "lbs"],
      [1e300, "kg"],
      [221.5, "pounds"],
      [221.5, null],
      [221.5, "stone"],
      [221.5, "constructor"],
      [221.5, "__proto__"],
      [Number.NaN, "lbs"],
      [-Infinity, "lbs"],
      [Infinity, "lbs"],
      ...seeded(20, 300, 13).flatMap((x): [number, Unit][] => [
        [x, "kg"],
        [x, "lbs"],
      ]),
    ],
  }),
  suite({
    name: "unitConversion.roundStoredDistance",
    description: "Math.round (halves up); NaN and infinities pass through.",
    run: (value: number) => roundStoredDistance(value),
    cases: [
      0.5,
      1.5,
      -0.5,
      999.5,
      Number.NaN,
      2.5,
      -1.5,
      -2.5,
      1234.4999,
      0.49999999999999994,
      4503599627370495.5,
      Infinity,
      -Infinity,
      1e21,
      5e-324,
      ...seeded(20, 10000, 17),
    ],
  }),
  suite({
    name: "unitConversion.stampForPreferences",
    description: "The stamp for a new row: the weight unit and the stored distance unit (m or ft).",
    run: (preferences: UnitPreferences) => {
      const stamp = stampForPreferences(preferences);
      return typeof stamp.weightUnit === "string" ? stamp : NOT_A_UNIT;
    },
    cases: [
      {},
      { weightUnit: "lb", distanceUnit: "mi" },
      { weightUnit: null, distanceUnit: "km" },
      KG_ATHLETE,
      LB_ATHLETE,
      { distanceUnit: "ft" },
      { weightUnit: "Pounds", distanceUnit: " MILES " },
      { weightUnit: "stone", distanceUnit: "kilometre" },
      { weightUnit: "", distanceUnit: "" },
      { weightUnit: "kg", distanceUnit: "constructor" },
      { weightUnit: "constructor" },
      { weightUnit: "__proto__", distanceUnit: "miles" },
    ],
  }),
  suite({
    name: "unitConversion.storedWeightToDisplay",
    description: "A stored weight in the current preference: identity for a legacy row or a matching stamp, else converted and rounded.",
    run: ({ value, stamp, preferences }: StampedInput) =>
      orNotAUnit(() => storedWeightToDisplay(value, stamp, preferences)),
    cases: [
      { value: 100, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "lbs" } },
      { value: 100, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "kg" } },
      { value: 100, stamp: {}, preferences: { weightUnit: "lbs" } },
      { value: 225, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: "kg" } },
      { value: 45, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: "kg" } },
      { value: 100, stamp: { weightUnit: "pounds" }, preferences: { weightUnit: "lbs" } },
      { value: 100.3, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "kg" } },
      { value: 100.3, stamp: { weightUnit: "stone" }, preferences: { weightUnit: "kg" } },
      { value: 100.3, stamp: { weightUnit: "stone" }, preferences: { weightUnit: "lbs" } },
      { value: 100, stamp: { weightUnit: null }, preferences: { weightUnit: "lbs" } },
      { value: 100, stamp: { weightUnit: "" }, preferences: { weightUnit: "lbs" } },
      { value: 100, stamp: { weightUnit: "kg" }, preferences: {} },
      { value: 100, stamp: { weightUnit: "lbs" }, preferences: {} },
      { value: 100, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: null } },
      { value: 100, stamp: { weightUnit: " KG " }, preferences: LB_ATHLETE },
      { value: -10, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "lbs" } },
      { value: 0, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: "kg" } },
      { value: 1, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: "kg" } },
      { value: Number.NaN, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "lbs" } },
      { value: Infinity, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: "kg" } },
      { value: 1e308, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "lbs" } },
      { value: 100.3, stamp: { weightUnit: "constructor" }, preferences: { weightUnit: "kg" } },
      { value: 100.3, stamp: { weightUnit: "constructor" }, preferences: { weightUnit: "lbs" } },
      { value: 100.3, stamp: { weightUnit: "constructor" }, preferences: { weightUnit: "constructor" } },
      { value: 100.3, stamp: { weightUnit: "constructor" }, preferences: { weightUnit: "__proto__" } },
      { value: 100, stamp: { weightUnit: "kg" }, preferences: { weightUnit: "constructor" } },
      { value: 100, stamp: { weightUnit: "lbs" }, preferences: { weightUnit: " __Proto__" } },
      { value: 100, stamp: {}, preferences: { weightUnit: "constructor" } },
      ...seeded(20, 400, 19).flatMap((value): StampedInput[] => [
        { value, stamp: { weightUnit: "kg" }, preferences: LB_ATHLETE },
        { value, stamp: { weightUnit: "lbs" }, preferences: KG_ATHLETE },
      ]),
    ],
  }),
  suite({
    name: "unitConversion.storedDistanceToDisplay",
    description: "A stored distance in the current preference's stored unit: identity for a legacy row, a matching or unknown stamp; else via metres, rounded.",
    run: ({ value, stamp, preferences }: StampedInput) => storedDistanceToDisplay(value, stamp, preferences),
    cases: [
      { value: 1000, stamp: { distanceUnit: "m" }, preferences: { distanceUnit: "miles" } },
      { value: 5280, stamp: { distanceUnit: "ft" }, preferences: { distanceUnit: "km" } },
      { value: 1, stamp: { distanceUnit: "km" }, preferences: { distanceUnit: "km" } },
      { value: 500, stamp: { distanceUnit: "xyz" }, preferences: { distanceUnit: "miles" } },
      { value: 100, stamp: {}, preferences: { distanceUnit: "miles" } },
      { value: 5000, stamp: { distanceUnit: "m" }, preferences: KG_ATHLETE },
      { value: 1000, stamp: { distanceUnit: "ft" }, preferences: LB_ATHLETE },
      { value: 16404, stamp: { distanceUnit: "ft" }, preferences: KG_ATHLETE },
      { value: 1, stamp: { distanceUnit: "miles" }, preferences: KG_ATHLETE },
      { value: 1, stamp: { distanceUnit: "mi" }, preferences: LB_ATHLETE },
      { value: 1, stamp: { distanceUnit: "km" }, preferences: LB_ATHLETE },
      { value: 100.4, stamp: { distanceUnit: "meters" }, preferences: {} },
      { value: 100.4, stamp: { distanceUnit: " FT " }, preferences: { distanceUnit: "mi" } },
      { value: 100, stamp: { distanceUnit: "feet" }, preferences: { distanceUnit: "constructor" } },
      { value: 1, stamp: { distanceUnit: "constructor" }, preferences: KG_ATHLETE },
      { value: 1, stamp: { distanceUnit: "__proto__" }, preferences: LB_ATHLETE },
      { value: 500, stamp: { distanceUnit: "yards" }, preferences: KG_ATHLETE },
      { value: 500, stamp: { distanceUnit: "" }, preferences: LB_ATHLETE },
      { value: 500, stamp: { distanceUnit: null }, preferences: LB_ATHLETE },
      { value: 500, stamp: { weightUnit: "kg" }, preferences: LB_ATHLETE },
      { value: 0.5, stamp: { distanceUnit: "m" }, preferences: LB_ATHLETE },
      { value: -1000, stamp: { distanceUnit: "m" }, preferences: LB_ATHLETE },
      { value: 0, stamp: { distanceUnit: "ft" }, preferences: KG_ATHLETE },
      { value: Number.NaN, stamp: { distanceUnit: "m" }, preferences: LB_ATHLETE },
      { value: Infinity, stamp: { distanceUnit: "ft" }, preferences: KG_ATHLETE },
      { value: -Infinity, stamp: { distanceUnit: "km" }, preferences: KG_ATHLETE },
      { value: 1e308, stamp: { distanceUnit: "miles" }, preferences: LB_ATHLETE },
      ...seeded(20, 50000, 23).flatMap((value): StampedInput[] => [
        { value, stamp: { distanceUnit: "m" }, preferences: LB_ATHLETE },
        { value, stamp: { distanceUnit: "ft" }, preferences: KG_ATHLETE },
      ]),
    ],
  }),
  suite({
    name: "unitConversion.restampSetPatch",
    description: "A partial set update re-stamped with the current units; the untouched value on a touched axis is converted from the old stamp.",
    run: ({ existing, patch, preferences }: RestampInput) =>
      orNotAUnit(() => {
        const out = restampSetPatch(existing, patch, preferences);
        return out.weightUnit === undefined || typeof out.weightUnit === "string" || out.weightUnit === null
          ? out
          : NOT_A_UNIT;
      }),
    cases: [
      {
        existing: { weight: 100, plannedWeight: 100, weightUnit: "kg" },
        patch: { weight: 225 },
        preferences: { weightUnit: "lbs" },
      },
      {
        existing: { weight: 100, plannedWeight: 100, weightUnit: "kg" },
        patch: { weight: null },
        preferences: { weightUnit: "lbs" },
      },
      {
        existing: { distance: 400, plannedDistance: 800, distanceUnit: "m" },
        patch: { plannedDistance: 1000 },
        preferences: { distanceUnit: "miles" },
      },
      {
        existing: { weight: 100, plannedWeight: 90, distance: 400, plannedDistance: 800 },
        patch: { weight: 105, distance: 500 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, distanceUnit: "m" },
        patch: {},
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, distanceUnit: "m" },
        patch: { weight: 230 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, weightUnit: "kg", distance: 400, distanceUnit: "m" },
        patch: { reps: 8 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg" },
        patch: { reps: 8, notes: null, plannedWeight: 200 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { distance: 400, plannedDistance: 1000, distanceUnit: "m", weight: 20, weightUnit: "kg" },
        patch: { distance: 1500 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg" },
        patch: { weight: 230, plannedWeight: null },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: null },
        patch: { weight: 105 },
        preferences: KG_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg" },
        patch: { weight: 105 },
        preferences: KG_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg" },
        patch: { plannedWeight: null },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 225, plannedWeight: 100, weightUnit: "lbs" },
        patch: { weight: 50 },
        preferences: {},
      },
      {
        existing: { weight: null, plannedWeight: 90, weightUnit: "kg" },
        patch: { plannedWeight: 95 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weightUnit: "kg" },
        patch: { weight: 60 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "" },
        patch: { weight: 105 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, weightUnit: "kg" },
        patch: { weightUnit: "kg" },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, weightUnit: "kg" },
        patch: { weight: 230, weightUnit: "kg" },
        preferences: LB_ATHLETE,
      },
      {
        existing: { distance: 1000, distanceUnit: "ft" },
        patch: { distanceUnit: null, weight: 10 },
        preferences: KG_ATHLETE,
      },
      {
        existing: { distance: 1000, plannedDistance: 2000, distanceUnit: "ft" },
        patch: { plannedDistance: 600 },
        preferences: KG_ATHLETE,
      },
      {
        existing: { distance: 3, plannedDistance: 5, distanceUnit: "km" },
        patch: { distance: 2500 },
        preferences: KG_ATHLETE,
      },
      {
        existing: { distance: 3, plannedDistance: 5, distanceUnit: "xyz" },
        patch: { distance: 2500 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { distance: 400, plannedDistance: 800, distanceUnit: "m" },
        patch: { distance: null, plannedDistance: null },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, plannedDistance: 800, distanceUnit: "m" },
        patch: { weight: 1, distance: 2 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: Number.NaN, plannedWeight: Infinity, weightUnit: "kg" },
        patch: { reps: 5, weight: undefined, plannedDistance: 3 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: Number.NaN, plannedWeight: Infinity, weightUnit: "kg", distance: Number.NaN, distanceUnit: "m" },
        patch: { reps: 5, weightUnit: "lbs", plannedWeight: 1, plannedDistance: 3 },
        preferences: LB_ATHLETE,
      },
      {
        existing: { weight: 100, weightUnit: null },
        patch: { weight: 5 },
        preferences: { weightUnit: "constructor" },
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg", distance: 400, distanceUnit: "m" },
        patch: { distance: 5 },
        preferences: { weightUnit: "constructor", distanceUnit: "miles" },
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "kg" },
        patch: { weight: 5 },
        preferences: { weightUnit: "constructor" },
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "constructor" },
        patch: { weight: 5 },
        preferences: { weightUnit: "constructor" },
      },
      {
        existing: { weight: 100, plannedWeight: 90, weightUnit: "constructor", distance: 1, distanceUnit: "__proto__" },
        patch: { weight: 5, plannedDistance: 2 },
        preferences: { weightUnit: "lbs", distanceUnit: "km" },
      },
    ],
  }),
  suite({
    name: "unitConversion.getWorkoutDistanceDisplay",
    description: "How the set editor shows a stored distance: metres for km; for miles, whole-kilometre metres, else miles (2 dp) from a mile, else feet.",
    run: ([value, unit]: [number, Unit]) => getWorkoutDistanceDisplay(value, raw(unit)),
    cases: [
      [1000, "km"],
      [1000.4, "km"],
      [1e7, "km"],
      [3280.84, "miles"],
      [3281, "miles"],
      [5280, "miles"],
      [7920, "miles"],
      [5306.4, "miles"],
      [5279.9, "miles"],
      [1640.42, "miles"],
      [100, "miles"],
      [0, "miles"],
      [-3280.84, "miles"],
      [15840, "miles"],
      [16404, "miles"],
      [164, "miles"],
      [5000, "km"],
      [1000.5, "km"],
      [-0.5, "km"],
      [-1.5, "km"],
      [0.4, "km"],
      [0, "km"],
      [3280.3, "miles"],
      [3279, "miles"],
      [3282.5, "miles"],
      [1640.4, "miles"],
      [6561.68, "miles"],
      [14124, "miles"],
      [6626.4, "miles"],
      [-5280, "miles"],
      [-7920, "miles"],
      [-100, "miles"],
      [-5279.9, "miles"],
      [-5306.4, "miles"],
      [5280, "mi"],
      [5280, " MILES "],
      [5280, null],
      [5280, ""],
      [5280, "feet"],
      [5280, "constructor"],
      [5280, "__proto__"],
      [1e-300, "miles"],
      [1e-300, "km"],
      [1e20, "km"],
      [1e21, "km"],
      [1.5e21, "km"],
      [-1.5e21, "km"],
      [Number.MAX_VALUE, "km"],
      [123456789012345680000, "km"],
      [2 ** 53 + 2, "km"],
      [1e16 + 4, "km"],
      [999999999999999.5, "km"],
      [1e25, "miles"],
      [5.28e24, "miles"],
      [1e13 * 5280 + 0.3 * 5280, "miles"],
      [5280 * 12345678901234.5 + 1.7, "miles"],
      [5280 * 1e15 + 1, "miles"],
      [5280 * 2e20, "miles"],
      [Number.MAX_VALUE, "miles"],
      [-Number.MAX_VALUE, "miles"],
      ...ODD_NUMBERS.slice(0, 3).flatMap((x): [number, Unit][] => [
        [x, "km"],
        [x, "miles"],
      ]),
      ...seeded(60, 100000, 29).map((x): [number, Unit] => [x, "miles"]),
      ...seeded(20, 1e9, 31).map((x): [number, Unit] => [x, "miles"]),
      ...seeded(20, 1e17, 37).map((x): [number, Unit] => [x, "miles"]),
      ...seeded(20, 1e9, 41).map((x): [number, Unit] => [x, "km"]),
      ...seeded(20, 1e19, 43).map((x): [number, Unit] => [x, "km"]),
    ],
  }),
  suite({
    name: "unitConversion.displayDistanceToStored",
    description: "A distance edited in m, ft or mi, back in the preference's stored unit (ft for miles, else m), rounded.",
    run: ([value, displayUnit, unit]: [number, WorkoutDistanceDisplayUnit, Unit]) =>
      displayDistanceToStored(value, displayUnit, raw(unit)),
    cases: [
      [1, "mi", "miles"],
      [1, "mi", "km"],
      [500, "ft", "km"],
      [1000, "m", "miles"],
      [0.5, "mi", "miles"],
      [3, "mi", "miles"],
      [5000, "m", "miles"],
      [5000, "m", "km"],
      [5280, "ft", "miles"],
      [1.5, "mi", "mi"],
      [100.4, "m", "km"],
      [100.5, "m", "km"],
      [-0.5, "m", "km"],
      [-1, "mi", "miles"],
      [0, "ft", "km"],
      [1, "mi", null],
      [1, "mi", "constructor"],
      [1, "ft", "ft"],
      [Number.NaN, "mi", "km"],
      [Infinity, "ft", "miles"],
      [1e308, "mi", "miles"],
      ...seeded(15, 30, 47).flatMap((x): [number, WorkoutDistanceDisplayUnit, Unit][] => [
        [x, "mi", "miles"],
        [x, "mi", "km"],
        [x * 1000, "ft", "km"],
        [x * 1000, "m", "miles"],
      ]),
    ],
  }),
];
