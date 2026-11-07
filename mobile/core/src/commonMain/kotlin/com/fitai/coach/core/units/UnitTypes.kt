package com.fitai.coach.core.units

import com.fitai.coach.core.api.Patch

/*
 * Types for the unit-conversion port (UnitConversion.kt), ported from
 * shared/unitConversion.ts. The TypeScript string unions become enums whose
 * `wireValue` is the string the server and the database use.
 */

/** A weight unit: TS `WeightUnit` (`"kg" | "lbs"`). */
public enum class WeightUnit(public val wireValue: String) {
    Kg("kg"),
    Lbs("lbs"),
}

/**
 * Any distance unit the TS parser recognises: TS `ParsedDistanceUnit`
 * (`StoredDistanceUnit | DistanceUnit`, so `"m" | "ft" | "km" | "miles"`).
 * Implemented by [StoredDistanceUnit] and [DistanceUnit].
 */
public sealed interface ParsedDistanceUnit {
    public val wireValue: String
}

/** An athlete's distance preference: TS `DistanceUnit` (`"km" | "miles"`). */
public enum class DistanceUnit(override val wireValue: String) : ParsedDistanceUnit {
    Km("km"),
    Miles("miles"),
}

/**
 * The unit a set's distance is stored in: TS `StoredDistanceUnit` (`"m" | "ft"`).
 * Metres for a km athlete, feet for a miles athlete ([getStoredDistanceUnit]).
 */
public enum class StoredDistanceUnit(override val wireValue: String) : ParsedDistanceUnit {
    M("m"),
    Ft("ft"),
}

/** The unit the set editor shows a distance in: TS `WorkoutDistanceDisplayUnit` (`"m" | "ft" | "mi"`). */
public enum class WorkoutDistanceDisplayUnit(public val wireValue: String) {
    M("m"),
    Ft("ft"),
    Mi("mi"),
}

/**
 * The athlete's unit preferences as stored on the user: TS `UnitPreferences`.
 * Raw strings, because the API sends them as strings; every function here
 * standardises them itself, and null means "not set" (kg / km).
 */
public data class UnitPreferences(
    val weightUnit: String? = null,
    val distanceUnit: String? = null,
)

/**
 * A stored set row's unit stamp (`exercise_sets.weight_unit` / `distance_unit`):
 * TS `StoredUnitStamp`. Null or empty means a legacy row written before the
 * stamp existed (audit L4), whose values are read as the current preference.
 */
public data class StoredUnitStamp(
    val weightUnit: String? = null,
    val distanceUnit: String? = null,
)

/** The stamp to write on a new row, from [stampForPreferences]. */
public data class UnitStamp(
    val weightUnit: WeightUnit,
    val distanceUnit: StoredDistanceUnit,
)

/**
 * A stored set row's stamped values, actual and prescribed per axis, with its
 * stamp: TS `StampedSetValues`. TS `undefined` and `null` mean the same here.
 */
public data class StampedSetValues(
    val weight: Double? = null,
    val plannedWeight: Double? = null,
    val distance: Double? = null,
    val plannedDistance: Double? = null,
    val weightUnit: String? = null,
    val distanceUnit: String? = null,
) {
    /** The row's own unit stamp. */
    public val stamp: StoredUnitStamp get() = StoredUnitStamp(weightUnit = weightUnit, distanceUnit = distanceUnit)
}

/**
 * The stamp-governed fields of a partial set update: TS `StampedSetPatch`.
 * [Patch.Absent] is a field the update leaves alone (TS `undefined`);
 * `Patch.Value(null)` sets it to null, which still counts as touching its
 * axis. Other fields of the update (reps, notes, …) are not affected by
 * [restampSetPatch]; send them alongside unchanged.
 */
public data class StampedSetPatch(
    val weight: Patch<Double> = Patch.Absent,
    val plannedWeight: Patch<Double> = Patch.Absent,
    val distance: Patch<Double> = Patch.Absent,
    val plannedDistance: Patch<Double> = Patch.Absent,
    val weightUnit: Patch<String> = Patch.Absent,
    val distanceUnit: Patch<String> = Patch.Absent,
)

/** A stored distance as the set editor shows it: TS `WorkoutDistanceDisplay`. */
public data class WorkoutDistanceDisplay(
    val value: Double,
    val unit: WorkoutDistanceDisplayUnit,
    /** `value` and unit as JS prints them, e.g. `"1.5 mi"`, `"1000 m"`, `"NaN ft"`. */
    val text: String,
)

/**
 * A height split for imperial display, from [cmToFtIn]. Doubles, not Ints,
 * because the TS lets NaN and infinities through (`cmToFtIn(NaN)` is
 * `{feet: NaN, inches: NaN}`) and keeps JS `%` signs for negative input.
 */
public data class FeetInches(
    val feet: Double,
    val inches: Double,
)

/**
 * Thrown where the TypeScript original produces no unit at all.
 *
 * The TS alias tables are plain object literals, so a lookup also finds
 * members inherited from `Object.prototype`. After lowercasing and trimming,
 * exactly two unit strings hit one: `"constructor"` (the `Object` function)
 * and `"__proto__"` (`Object.prototype`). The TS then returns that object
 * where a unit is expected (from the `standardize*` functions and
 * [stampForPreferences]), or throws a `TypeError` when it later calls
 * `toLowerCase` on it ([storedWeightToDisplay], [restampSetPatch] with such
 * a weight preference). Those calls throw this instead. Functions whose TS
 * result is still a number or a real unit reproduce it exactly; for example
 * `convertWeight(100.0, "constructor", "lbs")` is `100.0` and
 * `metersToUserDistance(5000.0, "__proto__")` is `5000.0`, as in the TS.
 */
public class UnitAliasException(
    /** The inherited member the unit string resolved to: `"constructor"` or `"__proto__"`. */
    public val member: String,
) : IllegalArgumentException(
    "Unit \"$member\" resolves to the inherited Object.prototype member in the TypeScript alias tables, not to a unit",
)
