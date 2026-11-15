package com.fitai.coach.ui.format

import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.js.jsRound
import com.fitai.coach.core.units.getStoredDistanceUnit

private const val HUNDRED = 100.0

/** A number as the web prints it: no trailing `.0`, at most two decimals. */
fun formatNumber(value: Double): String = jsNumberToString(jsRound(value * HUNDRED) / HUNDRED)

/** A set's weight in the unit it is stored in, "80 kg". */
fun formatWeight(value: Double, weightUnit: String?): String = "${formatNumber(value)} ${if (weightUnit == "lbs") "lbs" else "kg"}"

/** A set's distance in its stored unit (metres or feet), "400 m". */
fun formatSetDistance(
    value: Double,
    distanceUnit: String?,
): String = "${formatNumber(value)} ${getStoredDistanceUnit(distanceUnit).wireValue}"

/**
 * A set's minutes as the web's chips print them (formatMinutes): "45s" under
 * a minute, else "10min", or "23.1min" for a part of one.
 */
fun formatMinutes(minutes: Double): String {
    val tenths = jsRound(minutes * TENTHS).toLong()
    return when {
        !minutes.isFinite() -> ""
        minutes < 1 -> "${jsRound(minutes * SECONDS_PER_MINUTE).toLong()}s"
        tenths % TENTHS == 0L -> "${tenths / TENTHS}min"
        else -> "${tenths / TENTHS}.${tenths % TENTHS}min"
    }
}

private const val TENTHS = 10

/** Minutes as "m:ss", or "h:mm:ss" from an hour. */
fun formatClock(minutes: Double): String {
    val totalSeconds = jsRound(minutes * SECONDS_PER_MINUTE).toLong()
    val hours = totalSeconds / SECONDS_PER_HOUR
    val mins = (totalSeconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE
    val secs = totalSeconds % SECONDS_PER_MINUTE
    val ss = secs.toString().padStart(2, '0')
    return if (hours > 0) "$hours:${mins.toString().padStart(2, '0')}:$ss" else "$mins:$ss"
}

private const val SECONDS_PER_MINUTE = 60
private const val SECONDS_PER_HOUR = 3600
