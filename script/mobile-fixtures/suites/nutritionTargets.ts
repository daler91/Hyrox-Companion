/**
 * shared/nutritionTargets.ts: the targets editor's "Calculate from profile"
 * and the periodisation columns a saved target carries. The cases cross the
 * profile fields with every activity level and goal, walk the calorie floors
 * and the carb clamp, pin the explanation string (which prints numbers with JS
 * formatting), and cross saved versions with every choice the editor can make.
 */
import {
  type ActivityLevel,
  type BmrSex,
  calculateNutritionTarget,
  defaultPeriodizationConfig,
  nextPeriodizationSettings,
  type NutritionTargetInput,
  type PeriodizationChoice,
  type StoredPeriodization,
  type WeightGoalDirection,
} from "@shared/nutritionTargets";

import { suite } from "../types";

const ACTIVITY: ActivityLevel[] = ["sedentary", "light", "moderate", "active", "very_active"];
const GOALS: WeightGoalDirection[] = ["lose", "maintain", "gain"];
const SEXES: BmrSex[] = ["male", "female", null];

const profile = (
  bodyweightKg: number,
  heightCm: number,
  ageYears: number,
  sex: BmrSex,
  activityLevel: ActivityLevel,
  goalDirection: WeightGoalDirection,
  goalRateKgPerWeek: number,
  extra: Partial<NutritionTargetInput> = {},
): NutritionTargetInput => ({
  bodyweightKg,
  heightCm,
  ageYears,
  sex,
  activityLevel,
  goalDirection,
  goalRateKgPerWeek,
  ...extra,
});

/** Every sex, activity level and goal, at two body sizes. */
const GRID = SEXES.flatMap((sex) =>
  ACTIVITY.flatMap((activity) =>
    GOALS.flatMap((goal) => [
      profile(70, 175, 30, sex, activity, goal, 0.25),
      profile(58.4, 162.5, 41, sex, activity, goal, 0.5),
    ]),
  ),
);

/** Goal rates, including none, a negative magnitude and an aggressive one. */
const RATES = [0, -0, 0.1, 0.25, 0.33, 0.5, 0.75, 1, -0.5, 1.5].flatMap((rate) => [
  profile(80, 180, 35, "male", "moderate", "lose", rate),
  profile(80, 180, 35, "male", "moderate", "gain", rate),
  profile(80, 180, 35, "male", "moderate", "maintain", rate),
]);

const EDGES: NutritionTargetInput[] = [
  // The calorie floors: 1200 for a female profile, 1500 otherwise.
  profile(45, 150, 70, "female", "sedentary", "lose", 1),
  profile(45, 150, 70, "male", "sedentary", "lose", 1),
  profile(45, 150, 70, null, "sedentary", "lose", 1),
  // Protein and fat alone pass the (floored) calories: carbs clamp to 0.
  profile(150, 150, 80, "female", "sedentary", "lose", 1.5),
  profile(150, 150, 80, "male", "sedentary", "lose", 1.5),
  profile(120, 160, 60, null, "sedentary", "maintain", 0),
  // Custom g/kg anchors.
  profile(70, 175, 30, "male", "active", "maintain", 0, { proteinGPerKg: 2.2, fatGPerKg: 0.8 }),
  profile(70, 175, 30, "male", "active", "maintain", 0, { proteinGPerKg: 1.6 }),
  profile(70, 175, 30, "female", "light", "lose", 0.25, { fatGPerKg: 1.2 }),
  // Fractional profiles: rounding ties and JS number formatting in the explanation.
  profile(72.5, 178.3, 29, "male", "moderate", "lose", 0.25),
  profile(63.35, 165.25, 33, "female", "active", "gain", 0.2),
  profile(0.1 + 0.2, 175, 30, "male", "moderate", "maintain", 0),
  profile(88.88, 190.1, 19, null, "very_active", "gain", 0.4),
  profile(101.25, 185, 52, "male", "light", "lose", 0.75),
  profile(66.66666666666667, 170, 27, "female", "moderate", "maintain", 0),
  profile(50.05, 155.55, 45, "female", "sedentary", "maintain", 0),
  profile(70, 175, 30.5, "male", "moderate", "lose", 0.3),
];

const BASELINES = [0, 1, 99.9, 150, 223.4, 300, 351.5, 400, 512.25];
const LOADS = [null, 0, -5, 0.5, 10, 24.9, 25, 25.05, 30, 50, 63.33, 120];

const stored = (fields: Partial<StoredPeriodization>): StoredPeriodization => ({
  carbG: 300,
  periodizationEnabled: false,
  referenceUtss: null,
  carbGramsPerUtss: null,
  recoveryEnabled: false,
  recoveryProteinBumpFrac: null,
  preloadCarbGramsPerUtss: null,
  preloadDaysAhead: null,
  phaseAware: false,
  maxCarbDeltaG: null,
  ...fields,
});

/** Saved versions: none, flat, calibrated, half-filled, and without a carb baseline. */
const CURRENTS: (StoredPeriodization | null)[] = [
  null,
  stored({}),
  stored({
    periodizationEnabled: true,
    referenceUtss: 42.5,
    carbGramsPerUtss: 3.6,
    recoveryEnabled: true,
    recoveryProteinBumpFrac: 0.2,
    preloadCarbGramsPerUtss: 1.8,
    preloadDaysAhead: 2,
    phaseAware: true,
    maxCarbDeltaG: 225,
  }),
  stored({
    periodizationEnabled: true,
    referenceUtss: 30,
    carbGramsPerUtss: 5,
    recoveryEnabled: false,
    phaseAware: false,
  }),
  stored({
    carbG: 400,
    periodizationEnabled: false,
    referenceUtss: 60,
    carbGramsPerUtss: 3.3,
    preloadCarbGramsPerUtss: 1.7,
  }),
  stored({ carbG: null, periodizationEnabled: true, referenceUtss: 50, carbGramsPerUtss: 3 }),
  stored({
    carbG: 0,
    periodizationEnabled: true,
    referenceUtss: 50,
    carbGramsPerUtss: 3,
    maxCarbDeltaG: 100,
  }),
];

const choice = (
  carbG: number | null,
  periodize: boolean,
  recoveryEnabled: boolean,
  phaseAware: boolean,
): PeriodizationChoice => ({
  carbG,
  periodize,
  recoveryEnabled,
  phaseAware,
});

const CHOICES = [null, 150, 300, 412.7].flatMap((carbG) =>
  [true, false].flatMap((periodize) =>
    [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ].map(([recovery, phase]) => choice(carbG, periodize, recovery, phase)),
  ),
);

interface NextInput {
  current: StoredPeriodization | null;
  choice: PeriodizationChoice;
  recentAvgDailyUtss: number | null;
}

/** Every saved version against every choice; with no training history only the defaults change. */
const NEXT: NextInput[] = [
  ...CURRENTS.flatMap((current) =>
    CHOICES.map((c) => ({ current, choice: c, recentAvgDailyUtss: 37.25 })),
  ),
  ...CHOICES.map((c) => ({ current: null, choice: c, recentAvgDailyUtss: null })),
];

export const nutritionTargetsSuites = [
  suite({
    name: "nutritionTargets.calculateNutritionTarget",
    description:
      "A calorie and macro target from the profile: BMR, TDEE, goal adjustment, floors, the carb clamp, reason codes and the explanation.",
    run: (i: NutritionTargetInput) => calculateNutritionTarget(i),
    cases: [...EDGES, ...GRID, ...RATES],
  }),
  suite({
    name: "nutritionTargets.defaultPeriodizationConfig",
    description:
      "Periodisation defaults from a carb baseline and the athlete's typical daily load, and whether the reference is measured.",
    run: (i: { baselineCarbG: number; recentAvgDailyUtss: number | null }) =>
      defaultPeriodizationConfig(i.baselineCarbG, i.recentAvgDailyUtss),
    cases: BASELINES.flatMap((baselineCarbG) =>
      LOADS.map((recentAvgDailyUtss) => ({ baselineCarbG, recentAvgDailyUtss })),
    ),
  }),
  suite({
    name: "nutritionTargets.nextPeriodizationSettings",
    description:
      "The periodisation columns a new target version saves: the choice, with the current calibration re-based onto the new carb baseline.",
    run: (i: NextInput) => nextPeriodizationSettings(i.current, i.choice, i.recentAvgDailyUtss),
    cases: NEXT,
  }),
];
