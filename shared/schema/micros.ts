// Curated micronutrient display metadata. A deliberately zero-import module so
// the client can use it without evaluating the drizzle/zod schema graph in the
// browser; re-exported from ./nutrition (and the barrel) for back-compat.

/** Micronutrient unit — micros are stored per-100g in milligrams or micrograms. */
export type MicroUnit = "mg" | "mcg";

/**
 * Display metadata for one curated micronutrient (FR-5.1): canonical key, label,
 * unit, and FDA Reference Daily Intake. Shared so the client can render %RDI bars
 * (e.g. the Log Food dialog's nutrient panel) from the same source of truth the
 * server uses — the server's `MicroDef` extends this with importer-only fields.
 */
export interface MicroDisplayDef {
  key: string;
  label: string;
  unit: MicroUnit;
  rdi: number; // FDA Daily Value, in `unit`
}

/**
 * The curated micros, in display order. Mirrors the server's `MICRO_DEFS`
 * (key/label/unit/rdi); kept here so client and server can't drift on the
 * canonical set, labels, or reference intakes.
 */
export const MICRO_DISPLAY_DEFS: readonly MicroDisplayDef[] = [
  { key: "sodium", label: "Sodium", unit: "mg", rdi: 2300 },
  { key: "potassium", label: "Potassium", unit: "mg", rdi: 4700 },
  { key: "calcium", label: "Calcium", unit: "mg", rdi: 1300 },
  { key: "iron", label: "Iron", unit: "mg", rdi: 18 },
  { key: "magnesium", label: "Magnesium", unit: "mg", rdi: 420 },
  { key: "zinc", label: "Zinc", unit: "mg", rdi: 11 },
  { key: "vitaminC", label: "Vitamin C", unit: "mg", rdi: 90 },
  { key: "vitaminA", label: "Vitamin A", unit: "mcg", rdi: 900 },
  { key: "vitaminD", label: "Vitamin D", unit: "mcg", rdi: 20 },
  { key: "vitaminE", label: "Vitamin E", unit: "mg", rdi: 15 },
  { key: "vitaminK", label: "Vitamin K", unit: "mcg", rdi: 120 },
  { key: "vitaminB6", label: "Vitamin B6", unit: "mg", rdi: 1.7 },
  { key: "vitaminB12", label: "Vitamin B12", unit: "mcg", rdi: 2.4 },
  { key: "folate", label: "Folate", unit: "mcg", rdi: 400 },
];
