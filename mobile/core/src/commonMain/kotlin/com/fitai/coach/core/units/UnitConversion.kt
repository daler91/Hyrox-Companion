package com.fitai.coach.core.units

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.js.jsToFixed
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.sign

/*
 * Unit conversion, ported from shared/unitConversion.ts (and METRES_PER_MILE
 * from shared/units.ts): the parts the app needs on the device, listed in
 * docs/mobile-shared-logic.md. The text normaliser (normalizeWorkoutTextUnits)
 * and the display formatters are not ported.
 *
 * Every function reproduces the TypeScript exactly, including its rounding
 * (jsRound / jsToFixed), NaN and infinity pass-through and operation order;
 * the unitConversion.* golden fixtures pin it. Unit arguments are the raw
 * strings the API and the database carry: each is lowercased and trimmed
 * (JS whitespace) and looked up in the alias tables below, null or "" means
 * "not set", and an unknown string falls back as the TS does.
 *
 * One TS quirk is kept on purpose: the TS alias tables are plain objects, so
 * "constructor" and "__proto__" resolve to inherited Object.prototype members
 * rather than missing. Most functions then behave as the TS does with that
 * value (usually like an unknown unit that matches nothing, which is not
 * always the default: `metersToUserDistance(5000.0, "constructor")` is 5000.0).
 * Where the TS yields no unit at all, the port throws [UnitAliasException].
 */

/** Kilograms to pounds: TS `KG_TO_LBS`. */
public const val KG_TO_LBS: Double = 2.20462

/** Metres in a statute mile: TS `METRES_PER_MILE` (shared/units.ts), the one definition of that axis. */
public const val METRES_PER_MILE: Double = 1609.344

/** Miles per kilometre, derived as the TS does: `1000 / METRES_PER_MILE`. */
public const val KM_TO_MILES: Double = 1000 / METRES_PER_MILE

/** Metres to feet: TS `M_TO_FT`. */
public const val M_TO_FT: Double = 3.28084

/** TS `FEET_PER_MILE`. */
public const val FEET_PER_MILE: Double = 5280.0

/** How close a miles athlete's feet must be to a whole kilometre to show as metres: TS `CLEAN_KILOMETER_TOLERANCE_METERS`. */
public const val CLEAN_KILOMETER_TOLERANCE_METERS: Double = 0.5

/** TS `CM_PER_INCH`. */
public const val CM_PER_INCH: Double = 2.54

/** TS `INCHES_PER_FOOT`. */
public const val INCHES_PER_FOOT: Double = 12.0

/** Accepted weight unit spellings (lowercase, trimmed): TS `WEIGHT_UNIT_ALIASES`. */
public val WEIGHT_UNIT_ALIASES: Map<String, WeightUnit> = mapOf(
    "kg" to WeightUnit.Kg,
    "kgs" to WeightUnit.Kg,
    "kilo" to WeightUnit.Kg,
    "kilos" to WeightUnit.Kg,
    "kilogram" to WeightUnit.Kg,
    "kilograms" to WeightUnit.Kg,
    "lb" to WeightUnit.Lbs,
    "lbs" to WeightUnit.Lbs,
    "pound" to WeightUnit.Lbs,
    "pounds" to WeightUnit.Lbs,
)

/** Accepted distance preference spellings (lowercase, trimmed): TS `DISTANCE_UNIT_ALIASES`. */
public val DISTANCE_UNIT_ALIASES: Map<String, DistanceUnit> = mapOf(
    "km" to DistanceUnit.Km,
    "kms" to DistanceUnit.Km,
    "kilometer" to DistanceUnit.Km,
    "kilometers" to DistanceUnit.Km,
    "mi" to DistanceUnit.Miles,
    "mile" to DistanceUnit.Miles,
    "miles" to DistanceUnit.Miles,
)

/** TS `PARSED_DISTANCE_UNIT_ALIASES`. Has "kilometre(s)", which [DISTANCE_UNIT_ALIASES] does not. */
private val PARSED_DISTANCE_UNIT_ALIASES: Map<String, ParsedDistanceUnit> = mapOf(
    "m" to StoredDistanceUnit.M,
    "meter" to StoredDistanceUnit.M,
    "meters" to StoredDistanceUnit.M,
    "metre" to StoredDistanceUnit.M,
    "metres" to StoredDistanceUnit.M,
    "ft" to StoredDistanceUnit.Ft,
    "foot" to StoredDistanceUnit.Ft,
    "feet" to StoredDistanceUnit.Ft,
    "km" to DistanceUnit.Km,
    "kms" to DistanceUnit.Km,
    "kilometer" to DistanceUnit.Km,
    "kilometers" to DistanceUnit.Km,
    "kilometre" to DistanceUnit.Km,
    "kilometres" to DistanceUnit.Km,
    "mi" to DistanceUnit.Miles,
    "mile" to DistanceUnit.Miles,
    "miles" to DistanceUnit.Miles,
)

// ---------------------------------------------------------------------------
// Alias lookup, as the TS evaluates `ALIASES[unit.toLowerCase().trim()]`
// ---------------------------------------------------------------------------

/** What a TS `standardize*` call evaluates to: a unit, or an inherited Object.prototype member. */
private sealed interface Resolved<out U : Any> {
    data class Known<out U : Any>(val unit: U) : Resolved<U>

    /** `"constructor"` (the Object function) or `"__proto__"` (Object.prototype); `===` only to itself. */
    data class Inherited(val member: String) : Resolved<Nothing>
}

/** The lowercase keys a plain JS object literal inherits a truthy member for. */
private val INHERITED_MEMBERS = setOf("constructor", "__proto__")

/**
 * `aliases[unit.toLowerCase().trim()]`, or [fallback] when that is missing
 * (TS `|| default` and `?? null`; no alias value is falsy, so they agree).
 * A null or empty [unit] is falsy in the TS and returns [fallback] first.
 */
private fun <U : Any> resolve(unit: String?, aliases: Map<String, U>, fallback: U?): Resolved<U>? {
    if (unit.isNullOrEmpty()) return fallback?.let { Resolved.Known(it) }
    val key = jsTrim(unit.lowercase())
    if (key in INHERITED_MEMBERS) return Resolved.Inherited(key)
    return (aliases[key] ?: fallback)?.let { Resolved.Known(it) }
}

private fun resolveWeightUnit(unit: String?): Resolved<WeightUnit> =
    resolve(unit, WEIGHT_UNIT_ALIASES, WeightUnit.Kg)!!

private fun resolveDistanceUnit(unit: String?): Resolved<DistanceUnit> =
    resolve(unit, DISTANCE_UNIT_ALIASES, DistanceUnit.Km)!!

private fun resolveParsedDistanceUnit(unit: String?): Resolved<ParsedDistanceUnit>? =
    resolve(unit, PARSED_DISTANCE_UNIT_ALIASES, null)

private fun <U : Any> Resolved<U>.unitOrThrow(): U = when (this) {
    is Resolved.Known -> unit
    is Resolved.Inherited -> throw UnitAliasException(member)
}

private val KG = Resolved.Known(WeightUnit.Kg)
private val LBS = Resolved.Known(WeightUnit.Lbs)
private val KM = Resolved.Known(DistanceUnit.Km)
private val MILES = Resolved.Known(DistanceUnit.Miles)

// ---------------------------------------------------------------------------
// Normalising units
// ---------------------------------------------------------------------------

/**
 * The weight unit a free-form spelling means ("KG", " lbs ", "Pound"):
 * ports TS `standardizeWeightUnit`. Null, empty and unknown spellings are kg.
 *
 * @throws UnitAliasException for "constructor" / "__proto__", where the TS returns no unit.
 */
public fun standardizeWeightUnit(unit: String?): WeightUnit = resolveWeightUnit(unit).unitOrThrow()

/**
 * The distance preference a free-form spelling means ("mi", "Miles", "kms"):
 * ports TS `standardizeDistanceUnit`. Null, empty and unknown spellings
 * (including "m", "ft" and "kilometre") are km.
 *
 * @throws UnitAliasException for "constructor" / "__proto__", where the TS returns no unit.
 */
public fun standardizeDistanceUnit(unit: String?): DistanceUnit = resolveDistanceUnit(unit).unitOrThrow()

/**
 * Any distance unit a spelling means, keeping metres and feet apart from the
 * preference units: ports TS `standardizeParsedDistanceUnit`. Null for null,
 * empty and unknown spellings.
 *
 * @throws UnitAliasException for "constructor" / "__proto__", where the TS returns no unit.
 */
public fun standardizeParsedDistanceUnit(unit: String?): ParsedDistanceUnit? =
    resolveParsedDistanceUnit(unit)?.unitOrThrow()

/**
 * The unit set distances are stored in for a distance preference: feet for
 * a miles athlete, metres for everyone else (including "ft" and unknown
 * spellings, which are not preferences). Ports TS `getStoredDistanceUnit`.
 */
public fun getStoredDistanceUnit(distanceUnit: String?): StoredDistanceUnit =
    if (resolveDistanceUnit(distanceUnit) == MILES) StoredDistanceUnit.Ft else StoredDistanceUnit.M

// ---------------------------------------------------------------------------
// Converting values the athlete types
// ---------------------------------------------------------------------------

/**
 * Converts a weight between two unit spellings (the onboarding unit switch),
 * unrounded. Ports TS `convertWeight`. Identity when both standardise to the
 * same unit, or when either is "constructor" / "__proto__".
 */
public fun convertWeight(value: Double, from: String?, to: String?): Double {
    val standardFrom = resolveWeightUnit(from)
    val standardTo = resolveWeightUnit(to)
    if (standardFrom == standardTo) return value
    if (standardFrom == KG && standardTo == LBS) return value * KG_TO_LBS
    if (standardFrom == LBS && standardTo == KG) return value / KG_TO_LBS
    return value
}

/** A weight in kilograms in the athlete's unit, unrounded (bodyweight, goal rate). Ports TS `kgToUserWeight`. */
public fun kgToUserWeight(kg: Double, weightUnit: String?): Double =
    if (resolveWeightUnit(weightUnit) == LBS) kg * KG_TO_LBS else kg

/** A weight in the athlete's unit in kilograms, unrounded. Ports TS `userWeightToKg`. */
public fun userWeightToKg(value: Double, weightUnit: String?): Double =
    if (resolveWeightUnit(weightUnit) == LBS) value / KG_TO_LBS else value

/**
 * Metres in the athlete's distance unit (km or miles), unrounded. Ports TS
 * `metersToUserDistance`. For "constructor" / "__proto__" the TS matches
 * neither unit and returns the metres unchanged; so does this.
 */
public fun metersToUserDistance(meters: Double, distanceUnit: String?): Double {
    val standardUnit = resolveDistanceUnit(distanceUnit)
    if (standardUnit == KM) return meters / 1000
    if (standardUnit == MILES) return meters / METRES_PER_MILE
    return meters
}

/**
 * A distance in the athlete's unit (km or miles) in metres, unrounded
 * (manual distance, MAF test form). Ports TS `userDistanceToMeters`, keeping
 * its `(value / KM_TO_MILES) * 1000` for miles.
 */
public fun userDistanceToMeters(value: Double, distanceUnit: String?): Double {
    if (resolveDistanceUnit(distanceUnit) == MILES) return (value / KM_TO_MILES) * 1000
    return value * 1000
}

/**
 * A height in centimetres as whole feet and inches: ports TS `cmToFtIn`.
 * Rounds to the nearest inch with `Math.round` (so 1.27 cm, half an inch, is
 * 1 in), then splits with `Math.floor` and JS `%`, so a negative height gives
 * `feet = -1, inches = -1` for -2.54 cm.
 */
public fun cmToFtIn(cm: Double): FeetInches {
    val totalInches = jsRound(cm / CM_PER_INCH)
    var feet = floor(totalInches / INCHES_PER_FOOT)
    var inches = totalInches % INCHES_PER_FOOT
    // Unreachable (|x % 12| < 12), kept as in the TS.
    if (inches == INCHES_PER_FOOT) {
        feet += 1
        inches = 0.0
    }
    return FeetInches(feet = feet, inches = inches)
}

/** Feet and inches as centimetres, unrounded: ports TS `ftInToCm`. */
public fun ftInToCm(feet: Double, inches: Double): Double = (feet * INCHES_PER_FOOT + inches) * CM_PER_INCH

// ---------------------------------------------------------------------------
// Rounding for storage
// ---------------------------------------------------------------------------

private fun roundToNearestHalf(value: Double): Double = jsRound(value * 2) / 2

private fun roundStoredWeight(value: Double, weightUnit: Resolved<WeightUnit>): Double {
    if (!value.isFinite()) return value
    return if (weightUnit == LBS) jsRound(value) else roundToNearestHalf(value)
}

/**
 * A weight rounded as it is stored: whole pounds for lbs, the nearest half
 * for anything else, halves rounded up (`Math.round`, so -2.25 kg is -2).
 * NaN and infinities pass through. Ports TS `roundStoredWeight`.
 */
public fun roundStoredWeight(value: Double, weightUnit: String?): Double =
    roundStoredWeight(value, resolveWeightUnit(weightUnit))

/** A distance rounded as it is stored: `Math.round`, NaN and infinities passed through. Ports TS `roundStoredDistance`. */
public fun roundStoredDistance(value: Double): Double = if (value.isFinite()) jsRound(value) else value

// ---------------------------------------------------------------------------
// Per-row unit stamps (audit L4)
// ---------------------------------------------------------------------------

/**
 * The unit stamp to write on a new set row: the athlete's weight unit, and
 * the distance unit their distances are stored in. Ports TS `stampForPreferences`.
 *
 * @throws UnitAliasException when the weight preference is "constructor" / "__proto__".
 */
public fun stampForPreferences(preferences: UnitPreferences): UnitStamp = UnitStamp(
    weightUnit = standardizeWeightUnit(preferences.weightUnit),
    distanceUnit = getStoredDistanceUnit(preferences.distanceUnit),
)

/**
 * A stored weight as the athlete should see it now: ports TS
 * `storedWeightToDisplay`. Identity for a legacy (unstamped) row and when
 * the stamp matches the preference; otherwise converted from the stamp and
 * rounded for the preference ([roundStoredWeight]).
 *
 * @throws UnitAliasException when a conversion is needed into a weight
 *   preference of "constructor" / "__proto__" (the TS throws a TypeError).
 */
public fun storedWeightToDisplay(value: Double, stamp: StoredUnitStamp, preferences: UnitPreferences): Double {
    val stampUnit = stamp.weightUnit
    if (stampUnit.isNullOrEmpty()) return value
    val displayUnit = resolveWeightUnit(preferences.weightUnit)
    if (resolveWeightUnit(stampUnit) == displayUnit) return value
    // The TS passes the standardised display unit back through convertWeight and
    // roundStoredWeight, which standardise it again: a no-op for a unit, and the
    // TypeError for an inherited member.
    val display = displayUnit.unitOrThrow().wireValue
    return roundStoredWeight(convertWeight(value, stampUnit, display), display)
}

/**
 * A stored distance as the athlete should see it now: ports TS
 * `storedDistanceToDisplay`. Identity for a legacy (unstamped) row, for a
 * stamp matching the preference's stored unit and for an unknown stamp;
 * otherwise converted through metres and rounded ([roundStoredDistance]).
 * A stamp of "km" or "miles" is read in that unit; "constructor" /
 * "__proto__" is read as miles, as the TS falls through to its miles branch.
 */
public fun storedDistanceToDisplay(value: Double, stamp: StoredUnitStamp, preferences: UnitPreferences): Double {
    val stampUnit = stamp.distanceUnit
    if (stampUnit.isNullOrEmpty()) return value
    val displayUnit = getStoredDistanceUnit(preferences.distanceUnit)
    val storedUnit = resolveParsedDistanceUnit(stampUnit) ?: Resolved.Known(displayUnit)
    if (storedUnit == Resolved.Known(displayUnit)) return value
    return roundStoredDistance(metersToStoredDistance(parsedDistanceToMeters(value, storedUnit), displayUnit))
}

/**
 * Re-stamps a partial update to a stored set so the row's one stamp per
 * axis stays true for both its actual and prescribed value: ports TS
 * `restampSetPatch`.
 *
 * The patch's numbers are in the athlete's current units. An axis the patch
 * touches (a field set, null included) gets the current stamp, and the
 * other value on that axis, if the patch leaves it alone and the row has
 * one, is converted from the row's old stamp ([storedWeightToDisplay],
 * [storedDistanceToDisplay]). Axes the patch does not touch keep their
 * stamp and values, and a `weightUnit` / `distanceUnit` the caller put on
 * the patch passes through for them. Other fields of the update are not
 * part of [StampedSetPatch] and are unaffected.
 *
 * @throws UnitAliasException when the patch touches the weight axis and the
 *   weight preference is "constructor" / "__proto__" (the TS stamps the row
 *   with an Object.prototype member, or throws a TypeError converting it).
 */
public fun restampSetPatch(
    existing: StampedSetValues,
    patch: StampedSetPatch,
    preferences: UnitPreferences,
): StampedSetPatch {
    var out = patch

    if (patch.weight !is Patch.Absent || patch.plannedWeight !is Patch.Absent) {
        val weightStamp = resolveWeightUnit(preferences.weightUnit)
        if (patch.weight is Patch.Absent && existing.weight != null) {
            out = out.copy(weight = Patch.of(storedWeightToDisplay(existing.weight, existing.stamp, preferences)))
        }
        if (patch.plannedWeight is Patch.Absent && existing.plannedWeight != null) {
            out = out.copy(
                plannedWeight = Patch.of(storedWeightToDisplay(existing.plannedWeight, existing.stamp, preferences)),
            )
        }
        out = out.copy(weightUnit = Patch.of(weightStamp.unitOrThrow().wireValue))
    }

    if (patch.distance !is Patch.Absent || patch.plannedDistance !is Patch.Absent) {
        out = out.copy(distanceUnit = Patch.of(getStoredDistanceUnit(preferences.distanceUnit).wireValue))
        if (patch.distance is Patch.Absent && existing.distance != null) {
            out = out.copy(distance = Patch.of(storedDistanceToDisplay(existing.distance, existing.stamp, preferences)))
        }
        if (patch.plannedDistance is Patch.Absent && existing.plannedDistance != null) {
            out = out.copy(
                plannedDistance = Patch.of(
                    storedDistanceToDisplay(existing.plannedDistance, existing.stamp, preferences),
                ),
            )
        }
    }

    return out
}

/** TS `parsedDistanceToMeters`; anything but m, ft and km (miles, an inherited member) is read as miles. */
private fun parsedDistanceToMeters(value: Double, sourceUnit: Resolved<ParsedDistanceUnit>): Double =
    when ((sourceUnit as? Resolved.Known)?.unit) {
        StoredDistanceUnit.M -> value
        StoredDistanceUnit.Ft -> value / M_TO_FT
        DistanceUnit.Km -> value * 1000
        else -> value * METRES_PER_MILE
    }

/** TS `metersToStoredDistance`. */
private fun metersToStoredDistance(meters: Double, targetUnit: StoredDistanceUnit): Double =
    if (targetUnit == StoredDistanceUnit.Ft) meters * M_TO_FT else meters

// ---------------------------------------------------------------------------
// Set-editor distance
// ---------------------------------------------------------------------------

/** `Number(value.toFixed(decimals))`; toFixed prints NaN, infinities and |value| >= 1e21 as String(value). */
private fun fixedNumber(value: Double, decimals: Int): Double =
    if (value.isNaN() || abs(value) >= 1e21) value else jsToFixed(value, decimals).toDouble()

/** TS `formatCompactNumber`: `String(Number(value.toFixed(decimals)))`, so 1.50 prints "1.5" and 1.005 "1". */
private fun formatCompactNumber(value: Double, decimals: Int): String = jsNumberToString(fixedNumber(value, decimals))

/** A [WorkoutDistanceDisplay] whose text is [textValue] printed by formatCompactNumber (TS `formatWorkoutDistanceDisplayText`). */
private fun distanceDisplay(
    textValue: Double,
    unit: WorkoutDistanceDisplayUnit,
    decimals: Int,
    value: Double = textValue,
): WorkoutDistanceDisplay =
    WorkoutDistanceDisplay(value = value, unit = unit, text = "${formatCompactNumber(textValue, decimals)} ${unit.wireValue}")

/** TS `cleanWholeKilometerTarget`: the signed whole kilometre (>= 1000 m) within 0.5 m of [meters], or null. */
private fun cleanWholeKilometerTarget(meters: Double): Double? {
    val signOf = sign(meters)
    // Math.sign(meters) || 1. The fallback never shows: for ±0 and NaN the target check below returns null first.
    val sign = if (signOf == 0.0 || signOf.isNaN()) 1.0 else signOf
    val absMeters = abs(meters)
    val target = jsRound(absMeters / 1000) * 1000
    if (target < 1000) return null
    return if (abs(absMeters - target) <= CLEAN_KILOMETER_TOLERANCE_METERS) target * sign else null
}

/**
 * How the set editor shows a stored distance: ports TS
 * `getWorkoutDistanceDisplay`. For a km athlete, whole metres. For a miles
 * athlete (and any other preference spelling the TS does not read as km,
 * such as "constructor"), the stored feet show as whole metres when within
 * 0.5 m of a whole kilometre, else as miles to two decimals when at least a
 * mile, else as whole feet.
 */
public fun getWorkoutDistanceDisplay(value: Double, distanceUnit: String?): WorkoutDistanceDisplay {
    if (resolveDistanceUnit(distanceUnit) == KM) {
        return distanceDisplay(roundStoredDistance(value), WorkoutDistanceDisplayUnit.M, decimals = 0)
    }

    val feet = value
    val metricTarget = cleanWholeKilometerTarget(feet / M_TO_FT)
    if (metricTarget != null) return distanceDisplay(metricTarget, WorkoutDistanceDisplayUnit.M, decimals = 0)

    if (abs(feet) >= FEET_PER_MILE) {
        val miles = feet / FEET_PER_MILE
        // TS value: Number(formatCompactNumber(miles, 2)). The String/Number round
        // trip only turns -0 into 0.
        val shown = fixedNumber(miles, 2).let { if (it == 0.0) 0.0 else it }
        return distanceDisplay(miles, WorkoutDistanceDisplayUnit.Mi, decimals = 2, value = shown)
    }

    return distanceDisplay(roundStoredDistance(feet), WorkoutDistanceDisplayUnit.Ft, decimals = 0)
}

/**
 * A distance edited in the set editor's display unit, back in the stored
 * unit for the athlete's preference (feet for miles, else metres), rounded.
 * Ports TS `displayDistanceToStored`.
 */
public fun displayDistanceToStored(
    value: Double,
    displayUnit: WorkoutDistanceDisplayUnit,
    distanceUnit: String?,
): Double {
    val meters = when (displayUnit) {
        WorkoutDistanceDisplayUnit.Mi -> value * METRES_PER_MILE
        WorkoutDistanceDisplayUnit.Ft -> value / M_TO_FT
        WorkoutDistanceDisplayUnit.M -> value
    }
    return roundStoredDistance(metersToStoredDistance(meters, getStoredDistanceUnit(distanceUnit)))
}
