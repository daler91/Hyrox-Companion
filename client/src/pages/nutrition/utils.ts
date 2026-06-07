import type { Food, NutritionMacroTotals, NutritionTarget } from "@shared/schema";

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

/**
 * Today's totals against the current target, one row per macro the user has set
 * a goal for (unset/zero goals are skipped). Display-only; pure.
 */
export function computeTargetProgress(
  totals: NutritionMacroTotals,
  target: NutritionTarget | null,
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
