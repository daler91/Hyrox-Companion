import type { Food, MicroSummaryRow, NutritionMacroTotals, NutritionTarget } from "@shared/schema";
import { MICRO_DISPLAY_DEFS } from "@shared/schema";

const YMD = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Local calendar date (YYYY-MM-DD) for an instant — the server's logDate basis. */
export function toLocalDateStr(date: Date): string {
  return YMD.format(date);
}

export function todayStr(): string {
  return toLocalDateStr(new Date());
}

/** Add (or subtract) whole days to a YYYY-MM-DD string in date-only space. */
export function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** An ISO instant that falls on `date` in the user's local time. */
export function loggedAtForDate(date: string): string {
  if (date === todayStr()) return new Date().toISOString();
  // Local noon of that date — safely inside the day for any timezone offset.
  return new Date(`${date}T12:00:00`).toISOString();
}

const PER_100G = 100;

function scale(per100g: number | null, quantityG: number): number {
  return per100g == null ? 0 : (per100g * quantityG) / PER_100G;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Client-side per-100g scaling for a live preview while logging. Display only —
 * the numbers that get stored still come from USDA via the server, never the UI.
 */
export function previewNutrition(food: Food, quantityG: number): NutritionMacroTotals {
  return {
    calories: Math.round(scale(food.caloriesPer100g, quantityG)),
    protein: round1(scale(food.proteinPer100g, quantityG)),
    carb: round1(scale(food.carbPer100g, quantityG)),
    fat: round1(scale(food.fatPer100g, quantityG)),
    fiber: round1(scale(food.fiberPer100g, quantityG)),
  };
}

/**
 * Client-side per-100g scaling of a food's micronutrient map for the live
 * preview (display only). Mirrors the server's scaleMicros: only keys the food
 * actually carries survive (absent ≠ zero), and a non-positive quantity yields
 * an empty map.
 */
export function previewMicrosScaled(
  food: Pick<Food, "micros">,
  quantityG: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  if (!food.micros || quantityG <= 0 || Number.isNaN(quantityG)) return out;
  for (const [key, per100g] of Object.entries(food.micros)) {
    if (typeof per100g === "number" && Number.isFinite(per100g)) {
      out[key] = scale(per100g, quantityG);
    }
  }
  return out;
}

/**
 * Turn a scaled micro map into display rows via the shared curated defs — the
 * same shape the server's buildMicroSummary emits, so the row UI is reusable.
 * Micros with no data are omitted (absent ≠ zero).
 */
export function buildPreviewMicroRows(microsScaled: Record<string, number>): MicroSummaryRow[] {
  const rows: MicroSummaryRow[] = [];
  for (const def of MICRO_DISPLAY_DEFS) {
    const amount = microsScaled[def.key];
    if (amount == null) continue;
    rows.push({
      key: def.key,
      label: def.label,
      unit: def.unit,
      amount: round1(amount),
      rdi: def.rdi,
      pctRdi: Math.round((amount / def.rdi) * 100),
    });
  }
  return rows;
}

/** Atwater factors: protein & carb 4 kcal/g, fat 9 kcal/g. */
const KCAL_PER_G = { protein: 4, carb: 4, fat: 9 } as const;

export interface MacroEnergyShare {
  g: number;
  kcal: number;
  pct: number;
}

export interface MacroEnergyShares {
  protein: MacroEnergyShare;
  carb: MacroEnergyShare;
  fat: MacroEnergyShare;
  /** Energy derived from the macros (P*4 + C*4 + F*9). Can differ from a food's
   *  label calories; the ring normalises by this so the slices sum to 100%. */
  totalKcal: number;
}

/** Split macro grams into their energy contributions and % shares for the
 *  calorie-breakdown ring. All-zero input yields zero shares (empty ring). */
export function macroEnergyShares(
  m: Pick<NutritionMacroTotals, "protein" | "carb" | "fat">,
): MacroEnergyShares {
  const pKcal = Math.max(0, m.protein) * KCAL_PER_G.protein;
  const cKcal = Math.max(0, m.carb) * KCAL_PER_G.carb;
  const fKcal = Math.max(0, m.fat) * KCAL_PER_G.fat;
  const totalKcal = pKcal + cKcal + fKcal;
  const pct = (kcal: number) => (totalKcal > 0 ? Math.round((kcal / totalKcal) * 100) : 0);
  return {
    protein: { g: m.protein, kcal: pKcal, pct: pct(pKcal) },
    carb: { g: m.carb, kcal: cKcal, pct: pct(cKcal) },
    fat: { g: m.fat, kcal: fKcal, pct: pct(fKcal) },
    totalKcal,
  };
}

export const MEAL_LABELS: Record<string, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
  pre_workout: "Pre-workout",
  post_workout: "Post-workout",
};

/** One macro's progress toward its target (FR-5.2). `pct` is uncapped (can exceed 100). */
export interface TargetProgressRow {
  key: "calories" | "protein" | "carb" | "fat";
  label: string;
  value: number;
  target: number;
  pct: number;
  remaining: number;
}

const TARGET_FIELDS = [
  { key: "calories", targetKey: "calories", label: "Calories" },
  { key: "protein", targetKey: "proteinG", label: "Protein" },
  { key: "carb", targetKey: "carbG", label: "Carbs" },
  { key: "fat", targetKey: "fatG", label: "Fat" },
] as const;

/** The macro fields any target shape must carry to drive progress (a baseline
 *  `NutritionTarget` or a day's periodised `EffectiveTargetSummary`). */
export type TargetLike = Pick<NutritionTarget, "calories" | "proteinG" | "carbG" | "fatG">;

/**
 * Today's totals against the current target, one row per macro the user has set
 * a goal for (unset/zero goals are skipped). Display-only; pure.
 */
export function computeTargetProgress(
  totals: NutritionMacroTotals,
  target: TargetLike | null,
): TargetProgressRow[] {
  if (!target) return [];
  const rows: TargetProgressRow[] = [];
  for (const f of TARGET_FIELDS) {
    const goal = target[f.targetKey];
    if (goal == null || goal <= 0) continue;
    const value = totals[f.key];
    rows.push({
      key: f.key,
      label: f.label,
      value,
      target: goal,
      pct: Math.round((value / goal) * 100),
      remaining: round1(goal - value),
    });
  }
  return rows;
}

/** One macro's "effect on the day": today's running total, this serving's
 *  addition, and where that lands against the goal. Percentages are uncapped. */
export interface GoalContributionRow {
  key: "calories" | "protein" | "carb" | "fat";
  label: string;
  current: number;
  added: number;
  projected: number;
  target: number;
  currentPct: number;
  projectedPct: number;
}

/**
 * How logging `serving` moves today's running `totals` toward the target — one
 * row per macro the user has set a goal for. Reuses computeTargetProgress for
 * both the current and the projected (totals + serving) points, so the same
 * unset-goal skipping applies. Empty when no target is set.
 */
export function projectGoalContribution(
  todayTotals: NutritionMacroTotals,
  serving: NutritionMacroTotals,
  target: TargetLike | null,
): GoalContributionRow[] {
  if (!target) return [];
  const projectedTotals: NutritionMacroTotals = {
    calories: todayTotals.calories + serving.calories,
    protein: todayTotals.protein + serving.protein,
    carb: todayTotals.carb + serving.carb,
    fat: todayTotals.fat + serving.fat,
    fiber: todayTotals.fiber + serving.fiber,
  };
  const currentByKey = new Map(computeTargetProgress(todayTotals, target).map((r) => [r.key, r]));
  const rows: GoalContributionRow[] = [];
  for (const projected of computeTargetProgress(projectedTotals, target)) {
    const current = currentByKey.get(projected.key);
    if (!current) continue;
    rows.push({
      key: projected.key,
      label: projected.label,
      current: current.value,
      added: round1(projected.value - current.value),
      projected: projected.value,
      target: projected.target,
      currentPct: current.pct,
      projectedPct: projected.pct,
    });
  }
  return rows;
}

export function formatDateLabel(dateStr: string): string {
  const today = todayStr();
  if (dateStr === today) return "Today";
  if (dateStr === addDays(today, -1)) return "Yesterday";
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

// Immutable list editing for the nutrition dialogs' keyed rows (servings,
// ingredients). Pure and shared so the dialogs don't inline deep update/remove
// callbacks (which nest past the readable limit inside `.map` + event handlers).

/** Immutably merge `patch` into the row at `index`; other rows are untouched. */
export function updateAt<T>(arr: T[], index: number, patch: Partial<T>): T[] {
  return arr.map((row, j) => (j === index ? { ...row, ...patch } : row));
}

/** Immutably drop the element at `index`. */
export function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, j) => j !== index);
}

/**
 * Append `item` only when no existing element shares its key. Returns the SAME
 * array reference when the item is already present, so React can skip a
 * redundant render (matches the prior `prev.some(...) ? prev : [...prev, item]`).
 */
export function appendUnique<T>(arr: T[], item: T, keyOf: (x: T) => string): T[] {
  return arr.some((x) => keyOf(x) === keyOf(item)) ? arr : [...arr, item];
}
