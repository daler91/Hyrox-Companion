/**
 * shared/sessionFuellingTargets.ts: the fuelling panel's pre/post targets,
 * recomputed on every duration or RPE tap. The cases cross every RPE band with
 * every duration band, walk the bodyweight clamps and rounding ties, and pin
 * the explanation string, which interpolates numbers with JS formatting.
 */
import { computeSessionFuellingTarget, type SessionFuellingTargetInput } from "@shared/sessionFuellingTargets";

import { suite } from "../types";

const input = (
  durationMin: number | null,
  rpe: number | null,
  bodyweightKg: number | null,
): SessionFuellingTargetInput => ({ durationMin, rpe, bodyweightKg });

const RPES = [null, 0, 1, 3, 4, 4.5, 5, 7, 7.5, 8, 10];
const DURATIONS = [null, 0, -10, 1, 20, 29, 30, 30.5, 44, 44.9, 45, 60, 89, 90, 120, 150];

/** Every RPE band against every duration band, at one bodyweight. */
const BANDS = RPES.flatMap((rpe) => DURATIONS.map((durationMin) => input(durationMin, rpe, 70)));

/** The defaults, and the protein clamp and rounding ties, at a moderate hour. */
const BODYWEIGHTS = [null, 0, -0, -70, 50, 60, 63.3, 65, 66.6, 70, 72.5, 75, 133.3, 133.4, 135, 150].flatMap((bw) => [
  input(60, 6, bw),
  input(30, 3, bw),
  input(90, 9, bw),
]);

const EDGES: SessionFuellingTargetInput[] = [
  input(null, null, null),
  input(null, null, 70),
  input(30, 3, null),
  // Short and easy: 44 min at RPE 3 skips pre-session carbs; 45 min, or RPE 5, does not.
  input(44, 3, 70),
  input(45, 3, 70),
  input(44, 5, 70),
  input(44.99999999999999, 4, 70),
  // The unit tests' figures.
  input(60, 6, 75),
  input(30, 3, 75),
  input(90, 9, 75),
  input(60, 6, 50),
  input(60, 6, 150),
  // JS number formatting in the explanation.
  input(60, 6, 0.1 + 0.2),
  input(60, 6, 1e-7),
  input(60, 6, 0.000001),
  input(60, 6, 123456789.123),
  input(60, 6, 1e21),
  input(60, 6, 1.5e300),
  input(60, 6, 5e-324),
  input(60, 6, 9.9e-324),
  input(60, 6, 2.2250738585072014e-308),
  input(1e-7, 6, 70),
  input(0.1 + 0.2, 6, 70),
  input(5e-324, 6, 70),
  input(1e21, 6, 70),
  input(1e25, 6, 70),
  input(123456789012345680000, 6, 70),
  input(1 / 3, 6, 70),
  input(2 ** 53 + 2, 6, 70),
  // Non-finite inputs: NaN and Infinity pass the null and <= 0 checks.
  input(Number.NaN, 6, 70),
  input(60, Number.NaN, 70),
  input(60, 6, Number.NaN),
  input(Number.POSITIVE_INFINITY, 6, 70),
  input(Number.NEGATIVE_INFINITY, 6, 70),
  input(60, Number.NEGATIVE_INFINITY, 70),
  input(60, Number.POSITIVE_INFINITY, 70),
  input(60, 6, Number.POSITIVE_INFINITY),
  input(60, 6, Number.NEGATIVE_INFINITY),
  input(-0, -0, 70),
  // Absent keys behave as null.
  {} as unknown as SessionFuellingTargetInput,
  { bodyweightKg: 70 } as unknown as SessionFuellingTargetInput,
  { durationMin: 44, rpe: 3 } as unknown as SessionFuellingTargetInput,
];

export const sessionFuellingTargetsSuites = [
  suite({
    name: "sessionFuellingTargets.computeSessionFuellingTarget",
    description:
      "Pre/post carb and post protein targets from duration, RPE and bodyweight, with reason codes and the explanation.",
    run: (i: SessionFuellingTargetInput) => computeSessionFuellingTarget(i),
    cases: [...EDGES, ...BANDS, ...BODYWEIGHTS],
  }),
];
