import type { MicroSummaryRow } from "@shared/schema";

import { type LogEntryWithFood, sumMicros } from "./rollup";

/**
 * Curated micronutrient set for the daily micro panel (FR-5.1). One source of
 * truth for the canonical key, display label, unit, FDA reference daily intake
 * (RDI / Daily Value), and how to read the value from each importer.
 *
 * Units: each micro is stored per-100g in `unit` (mg or mcg). USDA foodNutrients
 * already report in mg or µg (µg === mcg), so a UNIT-FILTERED read (via the
 * importer's findNutrient) needs no conversion. Open Food Facts reports its
 * `*_100g` nutriments in GRAMS, so the OFF path multiplies by `OFF_GRAMS_TO_UNIT`
 * (×1000 → mg, ×1e6 → mcg) — the single guard against the classic 1000× mistake.
 */
export type MicroUnit = "mg" | "mcg";

export interface MicroDef {
  key: string;
  label: string;
  unit: MicroUnit;
  rdi: number; // FDA Daily Value, in `unit`
  usdaNumber: string; // FDC nutrient number
  usdaUnit: "mg" | "ug"; // expected USDA unitName — disambiguates IU vs metric encodings
  offKey: string; // OFF nutriment base key; we read `${offKey}_100g` (in grams)
}

export const MICRO_DEFS: readonly MicroDef[] = [
  { key: "sodium", label: "Sodium", unit: "mg", rdi: 2300, usdaNumber: "1093", usdaUnit: "mg", offKey: "sodium" },
  { key: "potassium", label: "Potassium", unit: "mg", rdi: 4700, usdaNumber: "1092", usdaUnit: "mg", offKey: "potassium" },
  { key: "calcium", label: "Calcium", unit: "mg", rdi: 1300, usdaNumber: "1087", usdaUnit: "mg", offKey: "calcium" },
  { key: "iron", label: "Iron", unit: "mg", rdi: 18, usdaNumber: "1089", usdaUnit: "mg", offKey: "iron" },
  { key: "magnesium", label: "Magnesium", unit: "mg", rdi: 420, usdaNumber: "1090", usdaUnit: "mg", offKey: "magnesium" },
  { key: "zinc", label: "Zinc", unit: "mg", rdi: 11, usdaNumber: "1095", usdaUnit: "mg", offKey: "zinc" },
  { key: "vitaminC", label: "Vitamin C", unit: "mg", rdi: 90, usdaNumber: "1162", usdaUnit: "mg", offKey: "vitamin-c" },
  { key: "vitaminA", label: "Vitamin A", unit: "mcg", rdi: 900, usdaNumber: "1106", usdaUnit: "ug", offKey: "vitamin-a" },
  { key: "vitaminD", label: "Vitamin D", unit: "mcg", rdi: 20, usdaNumber: "1114", usdaUnit: "ug", offKey: "vitamin-d" },
  { key: "vitaminE", label: "Vitamin E", unit: "mg", rdi: 15, usdaNumber: "1109", usdaUnit: "mg", offKey: "vitamin-e" },
  { key: "vitaminK", label: "Vitamin K", unit: "mcg", rdi: 120, usdaNumber: "1185", usdaUnit: "ug", offKey: "vitamin-k" },
  { key: "vitaminB6", label: "Vitamin B6", unit: "mg", rdi: 1.7, usdaNumber: "1175", usdaUnit: "mg", offKey: "vitamin-b6" },
  { key: "vitaminB12", label: "Vitamin B12", unit: "mcg", rdi: 2.4, usdaNumber: "1178", usdaUnit: "ug", offKey: "vitamin-b12" },
  { key: "folate", label: "Folate", unit: "mcg", rdi: 400, usdaNumber: "1177", usdaUnit: "ug", offKey: "vitamin-b9" },
];

// OFF `*_100g` values are in grams; multiply to reach the stored unit.
export const OFF_GRAMS_TO_UNIT: Record<MicroUnit, number> = { mg: 1000, mcg: 1_000_000 };

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Build the day's micronutrient summary (FR-5.1): for each curated micro the
 * day's entries actually carry data for, the scaled amount + %RDI. Micros with
 * no data are omitted (not zeroed) — absent ≠ zero, and most cached foods have
 * null micros until they're re-fetched from the importer.
 */
export function buildMicroSummary(rows: LogEntryWithFood[]): MicroSummaryRow[] {
  const totals = sumMicros(rows);
  const out: MicroSummaryRow[] = [];
  for (const def of MICRO_DEFS) {
    const amount = totals[def.key];
    if (amount == null) continue;
    out.push({
      key: def.key,
      label: def.label,
      unit: def.unit,
      amount: round1(amount),
      rdi: def.rdi,
      pctRdi: Math.round((amount / def.rdi) * 100),
    });
  }
  return out;
}
