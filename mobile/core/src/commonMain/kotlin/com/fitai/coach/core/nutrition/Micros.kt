package com.fitai.coach.core.nutrition

/** `MicroUnit`: a micronutrient's unit; foods store micros per 100 g in it. */
public enum class MicroUnit(public val wireValue: String) {
    Mg("mg"),
    Mcg("mcg"),
}

/**
 * `MicroDisplayDef`: one curated micronutrient's key, label, unit and FDA
 * Reference Daily Intake (in [unit]).
 */
public data class MicroDisplayDef(val key: String, val label: String, val unit: MicroUnit, val rdi: Double)

/**
 * Port of `MICRO_DISPLAY_DEFS` (shared/schema/micros.ts): the curated
 * micronutrients in display order, the same set, labels and intakes the
 * server's GET /api/v1/nutrition/micros reports against.
 */
public val MICRO_DISPLAY_DEFS: List<MicroDisplayDef> = listOf(
    MicroDisplayDef("sodium", "Sodium", MicroUnit.Mg, 2300.0),
    MicroDisplayDef("potassium", "Potassium", MicroUnit.Mg, 4700.0),
    MicroDisplayDef("calcium", "Calcium", MicroUnit.Mg, 1300.0),
    MicroDisplayDef("iron", "Iron", MicroUnit.Mg, 18.0),
    MicroDisplayDef("magnesium", "Magnesium", MicroUnit.Mg, 420.0),
    MicroDisplayDef("zinc", "Zinc", MicroUnit.Mg, 11.0),
    MicroDisplayDef("vitaminC", "Vitamin C", MicroUnit.Mg, 90.0),
    MicroDisplayDef("vitaminA", "Vitamin A", MicroUnit.Mcg, 900.0),
    MicroDisplayDef("vitaminD", "Vitamin D", MicroUnit.Mcg, 20.0),
    MicroDisplayDef("vitaminE", "Vitamin E", MicroUnit.Mg, 15.0),
    MicroDisplayDef("vitaminK", "Vitamin K", MicroUnit.Mcg, 120.0),
    MicroDisplayDef("vitaminB6", "Vitamin B6", MicroUnit.Mg, 1.7),
    MicroDisplayDef("vitaminB12", "Vitamin B12", MicroUnit.Mcg, 2.4),
    MicroDisplayDef("folate", "Folate", MicroUnit.Mcg, 400.0),
)
