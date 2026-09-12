import type { ParseLabelResponse } from "./schema/nutrition";

/**
 * Canonical label-scan payload, shared by the two suites that need the whole
 * ~25-field shape: the server route spec (what the parser resolves with) and
 * the ScanLabelButton spec (what the button hands its onExtracted callback).
 * Kept in one place so the literal isn't copy-pasted across the boundary.
 */
export const OAT_BAR_LABEL_SCAN: ParseLabelResponse = {
  label: {
    productName: "Oat Bar",
    brand: null,
    servingSizeText: "1 bar (45g)",
    servingSizeG: 45,
    servingsPerContainer: null,
    per100g: { calories: 400, protein: 10, carb: 60, fat: 12, fiber: 6 },
    perServing: null,
    basis: "per100g",
    confidence: 90,
  },
  suggestion: {
    name: "Oat Bar",
    brand: null,
    caloriesPer100g: 400,
    proteinPer100g: 10,
    carbPer100g: 60,
    fatPer100g: 12,
    fiberPer100g: 6,
    servingSizeG: 45,
    servings: [],
  },
  warnings: [],
};
