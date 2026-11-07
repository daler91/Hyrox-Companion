/**
 * shared/mealFuelling.ts, mergeMealOverride only: the meal-target editor's
 * preview of what a save will read. The grid runs every macro field through
 * absent / echo of the split / 0 g / a new figure, with and without a calorie
 * pin, over splits with and without a share of the day's calorie goal.
 */
import { type MealFuelOverride, type MealFuelValues, mergeMealOverride } from "@shared/mealFuelling";

import { suite } from "../types";

type Case = { split: MealFuelValues; override: MealFuelOverride };

const split = (calories: number, carbG: number, proteinG: number, fatG: number): MealFuelValues => ({
  calories,
  carbG,
  proteinG,
  fatG,
});

/** Calories equal to the macros' energy (80·4 + 40·4 + 20·9 = 660): no share. */
const AT_MACRO_ENERGY = split(660, 80, 40, 20);
/** The inventory's "calories equal its macro energy" split; its macros come to 660, so 60 kcal over. */
const FULL_MACROS = split(720, 80, 40, 20);
/** A share of a 2,500 kcal + 150 g protein day: carbs and fat unset (0 g). */
const PROTEIN_ONLY = split(720, 0, 43, 0);
/** The same day as the unit tests build it. */
const PROTEIN_ONLY_TESTS = split(720, 0, 37.5, 0);
/** No calorie goal: the calories are the protein's energy, so 0 g pins are figures. */
const NO_CALORIE_GOAL = split(160, 0, 40, 0);
/** A calorie-only day: every macro unset. */
const CALORIE_ONLY = split(750, 0, 0, 0);
/** The fasted pre-workout snack: its carbs alone. */
const FASTED_PRE = split(120, 30, 0, 0);
/** A share of a day with protein and fat goals but carbs unset. */
const CARB_ONLY_UNSET = split(900, 0, 40, 20);
/** Calories below the macros' energy. */
const UNDER_MACROS = split(500, 80, 40, 20);
/** Fractional figures, as computeMealFuelTargets rounds them. */
const FRACTIONAL = split(612, 70.3, 33.7, 18.2);
/** Macros off the 0.1 g grid: round1 changes them, so even {} counts as a macro edit. */
const OFF_GRID = split(700, 80.05, 40, 20);

type MacroKey = "carbG" | "proteinG" | "fatG";
const MACROS: MacroKey[] = ["carbG", "proteinG", "fatG"];
const NEW_FIGURE: Record<MacroKey, [number, number]> = { carbG: [80, 90], proteinG: [50, 60], fatG: [20, 25] };

/** A new figure for a macro, different from the split's. */
function changed(s: MealFuelValues, key: MacroKey): number {
  const [first, second] = NEW_FIGURE[key];
  return s[key] === first ? second : first;
}

/**
 * Each macro absent, echoed, 0 g or changed (deduplicated), times calories
 * absent or pinned to 900. The 0 g pin is only distinct on a split that has
 * an unset (0 g) macro; elsewhere it is one more changed figure, so it is left out.
 */
function grid(s: MealFuelValues): Case[] {
  const hasUnsetMacro = MACROS.some((key) => s[key] === 0);
  const states = (key: MacroKey): (number | undefined)[] => [
    ...new Set<number | undefined>([undefined, s[key], ...(hasUnsetMacro ? [0] : []), changed(s, key)]),
  ];
  const out: Case[] = [];
  for (const calories of [undefined, 900])
    for (const carbG of states("carbG"))
      for (const proteinG of states("proteinG"))
        for (const fatG of states("fatG")) {
          const override: MealFuelOverride = {};
          if (calories !== undefined) override.calories = calories;
          if (carbG !== undefined) override.carbG = carbG;
          if (proteinG !== undefined) override.proteinG = proteinG;
          if (fatG !== undefined) override.fatG = fatG;
          out.push({ split: s, override });
        }
  return out;
}

/** Every subset of fields pinned to a new figure (16 overrides). */
function presence(s: MealFuelValues): Case[] {
  const out: Case[] = [];
  for (let mask = 0; mask < 16; mask++) {
    const override: MealFuelOverride = {};
    if (mask & 1) override.calories = 900;
    MACROS.forEach((key, i) => {
      if (mask & (2 << i)) override[key] = changed(s, key);
    });
    out.push({ split: s, override });
  }
  return out;
}

const INVENTORY: Case[] = [
  { split: FULL_MACROS, override: {} },
  { split: FULL_MACROS, override: { calories: 900 } },
  { split: FULL_MACROS, override: { calories: 899.6 } },
  { split: FULL_MACROS, override: { proteinG: 50 } },
  { split: FULL_MACROS, override: { proteinG: 50, carbG: 80, fatG: 20 } },
  { split: FULL_MACROS, override: { carbG: 80.05 } },
  { split: PROTEIN_ONLY, override: { proteinG: 50 } },
  { split: PROTEIN_ONLY, override: { proteinG: 50, carbG: 80, fatG: 20 } },
  { split: PROTEIN_ONLY, override: { calories: 900, proteinG: 50, carbG: 0, fatG: 0 } },
  { split: NO_CALORIE_GOAL, override: { calories: 900, proteinG: 50, carbG: 0, fatG: 0 } },
];

const EXTRAS: Case[] = [
  // The unit tests' figures.
  { split: PROTEIN_ONLY_TESTS, override: { proteinG: 50 } },
  { split: PROTEIN_ONLY_TESTS, override: { calories: 900, proteinG: 50 } },
  { split: PROTEIN_ONLY_TESTS, override: { calories: 900, proteinG: 50, carbG: 80, fatG: 20 } },
  { split: PROTEIN_ONLY_TESTS, override: { calories: 900, proteinG: 37.5, carbG: 0, fatG: 0 } },
  { split: CALORIE_ONLY, override: { calories: 800, proteinG: 40, carbG: 0, fatG: 0 } },
  { split: FASTED_PRE, override: { calories: 300, proteinG: 10, carbG: 40, fatG: 0 } },
  // Explicit nulls behave as absent fields.
  { split: FULL_MACROS, override: { calories: null, carbG: null, proteinG: null, fatG: null } },
  { split: PROTEIN_ONLY, override: { calories: null, carbG: null, proteinG: null, fatG: null } },
  { split: CALORIE_ONLY, override: { calories: 800, proteinG: null, carbG: null, fatG: null } },
  { split: PROTEIN_ONLY, override: { calories: null, proteinG: 50, carbG: null, fatG: 0 } },
  { split: PROTEIN_ONLY, override: { calories: 900, proteinG: 50, carbG: 80, fatG: null } },
  { split: FULL_MACROS, override: { calories: null, proteinG: 50, carbG: 80, fatG: 20 } },
  // Pinned calories round with Math.round (ties towards +Infinity).
  { split: FULL_MACROS, override: { calories: 899.5 } },
  { split: FULL_MACROS, override: { calories: 899.4999999999999 } },
  { split: FULL_MACROS, override: { calories: -899.5 } },
  { split: FULL_MACROS, override: { calories: -0.5 } },
  { split: FULL_MACROS, override: { calories: 0.4 } },
  { split: FULL_MACROS, override: { calories: 0 } },
  { split: FULL_MACROS, override: { calories: 1e21 } },
  { split: PROTEIN_ONLY, override: { calories: 899.5, proteinG: 50 } },
  // Macros round to 0.1 g before they are compared with the split.
  { split: FULL_MACROS, override: { carbG: 80.04 } },
  { split: FULL_MACROS, override: { proteinG: 40.05 } },
  { split: FULL_MACROS, override: { fatG: 0.05 } },
  { split: FULL_MACROS, override: { fatG: 1.005 } },
  { split: FULL_MACROS, override: { fatG: 2.675 } },
  { split: PROTEIN_ONLY, override: { proteinG: 43.04 } },
  { split: PROTEIN_ONLY, override: { proteinG: 43.05 } },
  { split: PROTEIN_ONLY, override: { carbG: 0.04 } },
  { split: PROTEIN_ONLY, override: { carbG: -0.04, fatG: -0.05, proteinG: 50 } },
  { split: PROTEIN_ONLY, override: { carbG: 0.05, fatG: 0, proteinG: 50 } },
  { split: PROTEIN_ONLY, override: { carbG: -10, proteinG: 50, fatG: 0 } },
  { split: FULL_MACROS, override: { carbG: -10, proteinG: 50, fatG: 20 } },
  { split: FULL_MACROS, override: { carbG: 1e300, proteinG: 50, fatG: 20 } },
  // Pinning an unset macro past the share leaves nothing of it (Math.max(0, …)).
  { split: PROTEIN_ONLY, override: { carbG: 200 } },
  { split: PROTEIN_ONLY, override: { carbG: 200, calories: 900 } },
  { split: CALORIE_ONLY, override: { proteinG: 100, carbG: 100 } },
  { split: CALORIE_ONLY, override: { proteinG: 300, fatG: 0 } },
  // Only carbs unset: the share is kept while carbs stay at 0 g, and only pinned carbs fill it.
  { split: CARB_ONLY_UNSET, override: { proteinG: 50 } },
  { split: CARB_ONLY_UNSET, override: { fatG: 30 } },
  { split: CARB_ONLY_UNSET, override: { proteinG: 50, fatG: 30 } },
  { split: CARB_ONLY_UNSET, override: { carbG: 80 } },
  { split: CARB_ONLY_UNSET, override: { carbG: 80, proteinG: 50, fatG: 30 } },
  { split: CARB_ONLY_UNSET, override: { calories: 950, carbG: 0, proteinG: 50, fatG: 20 } },
  { split: CARB_ONLY_UNSET, override: { carbG: 0, proteinG: 50, fatG: 30 } },
  // A full set that matches the split edits nothing, so pinned calories stand.
  { split: FULL_MACROS, override: { calories: 800, proteinG: 40, carbG: 80, fatG: 20 } },
  // Splits off the 0.1 g grid, below their macros' energy, and fractional.
  { split: OFF_GRID, override: {} },
  { split: OFF_GRID, override: { calories: 900 } },
  { split: OFF_GRID, override: { carbG: 80.05, proteinG: 40, fatG: 20 } },
  { split: split(700, 80.04, 40, 20), override: {} },
  { split: split(720, 0.04, 43, 0), override: { proteinG: 50 } },
  ...presence(AT_MACRO_ENERGY),
  ...presence(UNDER_MACROS),
  ...presence(FRACTIONAL),
  { split: UNDER_MACROS, override: { carbG: 0, proteinG: 0, fatG: 0 } },
  { split: FRACTIONAL, override: { carbG: 70.25, proteinG: 33.75 } },
  { split: FRACTIONAL, override: { calories: 611.5, fatG: 18.15 } },
];

export const mealFuellingSuites = [
  suite({
    name: "mealFuelling.mergeMealOverride",
    description:
      "A meal's figures under an override of its split: macros round1'd, calories by the precedence in mergeMealOverride.",
    run: ({ split: s, override }: Case) => mergeMealOverride(s, override),
    cases: [
      ...INVENTORY,
      ...EXTRAS,
      ...grid(FULL_MACROS),
      ...grid(PROTEIN_ONLY),
      ...grid(NO_CALORIE_GOAL),
      ...grid(CALORIE_ONLY),
      ...grid(FASTED_PRE),
    ],
  }),
];
