package com.fitai.coach.core.dates

import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.truncate

/*
 * The parts of JavaScript's Date and Number that shared/dateUtils.ts relies
 * on, reproduced so the port gives the same answer for every string, not only
 * for well-formed YYYY-MM-DD: its private `toUtcEpoch` splits on "-", runs
 * `Number` on each part and hands them to `Date.UTC`, which rolls a day 30 of
 * February into March, reads the years 0–99 as 1900–1999 and returns NaN for
 * anything unparseable. Pinned by the `dateUtils.*` fixture suites.
 *
 * Time values are Doubles, as in JS: milliseconds since 1970-01-01T00:00Z,
 * NaN for an invalid date.
 */

internal const val MS_PER_DAY: Double = 86_400_000.0

/** The largest |time value| a JS Date holds: 100,000,000 days either side of the epoch. */
private const val MAX_TIME_MS: Double = 8.64e15

/** What the TypeScript prints for an invalid date: `${NaN}-${String(NaN).padStart(2, "0")}-…`. */
internal const val INVALID_DATE_TEXT: String = "NaN-NaN-NaN"

/** `toUtcEpoch` in shared/dateUtils.ts: `Date.UTC(year, month - 1, day)` over `date.split("-").map(Number)`. */
internal fun toUtcEpoch(date: String): Double {
    val parts = date.split('-')
    // `const [year = NaN, month = NaN, day = NaN] = …`: a missing part is NaN, extra parts are ignored.
    val year = parts.getOrNull(0)?.let(::jsStringToNumber) ?: Double.NaN
    val month = parts.getOrNull(1)?.let(::jsStringToNumber) ?: Double.NaN
    val day = parts.getOrNull(2)?.let(::jsStringToNumber) ?: Double.NaN
    return jsDateUtc(year, month - 1, day)
}

/**
 * `Date.UTC(year, monthIndex, day)` as V8 implements it: a year whose
 * integer part is 0–99 becomes 1900 + it, out-of-range months and days roll
 * over, fractions truncate, and the result is NaN outside the Date range.
 */
internal fun jsDateUtc(year: Double, monthIndex: Double, day: Double): Double {
    var fullYear = year
    if (!year.isNaN()) {
        val integer = truncate(year)
        if (integer >= 0.0 && integer <= 99.0) fullYear = 1900.0 + integer
    }
    return timeClip(makeDay(fullYear, monthIndex, day) * MS_PER_DAY)
}

/** ECMAScript TimeClip: NaN outside ±8.64e15 ms, else truncated to an integer. */
internal fun timeClip(time: Double): Double =
    if (time.isFinite() && abs(time) <= MAX_TIME_MS) truncate(time) + 0.0 else Double.NaN

/**
 * MakeDay, following V8 (src/date/date.cc): days from the epoch to the given
 * day. V8 refuses years beyond ±1,000,000 and month indexes beyond
 * ±10,000,000 up front, and does the rest in 32-bit integers.
 */
private fun makeDay(year: Double, monthIndex: Double, day: Double): Double {
    val inRange = year >= -1_000_000.0 && year <= 1_000_000.0 &&
        monthIndex >= -10_000_000.0 && monthIndex <= 10_000_000.0 && day.isFinite()
    if (!inRange) return Double.NaN
    var y = year.toInt()
    var m = monthIndex.toInt()
    y += m / 12
    m %= 12
    if (m < 0) {
        m += 12
        y -= 1
    }
    val shifted = y + YEAR_DELTA
    var dayFromYear = 365 * shifted + shifted / 4 - shifted / 100 + shifted / 400 - BASE_DAY
    val leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0)
    dayFromYear += (if (leap) LEAP_DAYS_BEFORE_MONTH else DAYS_BEFORE_MONTH)[m]
    return (dayFromYear - 1).toDouble() + truncate(day)
}

/** V8's offset that keeps the year arithmetic positive: -1 modulo 400. */
private const val YEAR_DELTA = 399_999
private const val BASE_DAY = 365 * (1970 + YEAR_DELTA) + (1970 + YEAR_DELTA) / 4 -
    (1970 + YEAR_DELTA) / 100 + (1970 + YEAR_DELTA) / 400
private val DAYS_BEFORE_MONTH = intArrayOf(0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334)
private val LEAP_DAYS_BEFORE_MONTH = intArrayOf(0, 31, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335)

/** A proleptic Gregorian UTC calendar day, as the `getUTCFullYear` / `getUTCMonth() + 1` / `getUTCDate` getters read it. */
internal class UtcDate(val year: Long, val month: Int, val day: Int)

/** Whole days since the epoch of a valid (finite, clipped) time value. */
private fun epochDay(time: Double): Long = floor(time / MS_PER_DAY).toLong()

/** The UTC calendar day of a valid time value (Hinnant's civil_from_days). */
internal fun utcDate(time: Double): UtcDate {
    val z = epochDay(time) + 719_468
    val era = (if (z >= 0) z else z - 146_096) / 146_097
    val dayOfEra = z - era * 146_097
    val yearOfEra = (dayOfEra - dayOfEra / 1_460 + dayOfEra / 36_524 - dayOfEra / 146_096) / 365
    val dayOfYear = dayOfEra - (365 * yearOfEra + yearOfEra / 4 - yearOfEra / 100)
    val shiftedMonth = (5 * dayOfYear + 2) / 153
    val day = (dayOfYear - (153 * shiftedMonth + 2) / 5 + 1).toInt()
    val month = (if (shiftedMonth < 10) shiftedMonth + 3 else shiftedMonth - 9).toInt()
    val year = yearOfEra + era * 400 + if (month <= 2) 1 else 0
    return UtcDate(year, month, day)
}

/** `getUTCDay()` of a valid time value: 0 for Sunday to 6 for Saturday. */
internal fun utcWeekday(time: Double): Int = (epochDay(time) + 4).mod(7L).toInt()

/**
 * `toISOString().slice(0, 10)` of a valid time value: `YYYY-MM-DD` for the
 * years 0–9999, otherwise the expanded `±YYYYYY-MM` cut at ten characters.
 */
internal fun isoDateUtc(time: Double): String {
    val date = utcDate(time)
    val year = when (date.year) {
        in 0L..9999L -> date.year.toString().padStart(4, '0')
        else -> (if (date.year < 0) "-" else "+") + abs(date.year).toString().padStart(6, '0')
    }
    return "$year-${date.month.pad2()}-${date.day.pad2()}".take(10)
}

internal fun Int.pad2(): String = toString().padStart(2, '0')

/**
 * `Number(text)` for a string (ECMAScript StringToNumber): JS whitespace
 * trimmed, "" is 0, `[+-]Infinity`, decimal literals with an optional sign,
 * fraction and exponent, and unsigned `0x` / `0o` / `0b` integers; anything
 * else is NaN. No numeric separators, no legacy octal ("010" is 10).
 *
 * The non-decimal literals are accumulated in a Double, which is exact below
 * 2^53: every larger value lands outside the Date range, where the exact
 * figure does not matter.
 */
internal fun jsStringToNumber(text: String): Double {
    val s = text.trim(::isJsWhitespace)
    if (s.isEmpty()) return 0.0
    when (s) {
        "Infinity", "+Infinity" -> return Double.POSITIVE_INFINITY
        "-Infinity" -> return Double.NEGATIVE_INFINITY
    }
    if (s.length > 2 && s[0] == '0') {
        val radix = when (s[1]) {
            'x', 'X' -> 16
            'o', 'O' -> 8
            'b', 'B' -> 2
            else -> 0
        }
        if (radix != 0) return parseUnsignedInteger(s.substring(2), radix)
    }
    return parseDecimalLiteral(s)
}

private fun parseUnsignedInteger(digits: String, radix: Int): Double {
    var value = 0.0
    for (c in digits) {
        // ASCII only: Kotlin's digitToIntOrNull would also take other scripts' digits.
        val digit = when (c) {
            in '0'..'9' -> c - '0'
            in 'a'..'z' -> c - 'a' + 10
            in 'A'..'Z' -> c - 'A' + 10
            else -> return Double.NaN
        }
        if (digit >= radix) return Double.NaN
        value = value * radix + digit
    }
    return value
}

/** StrDecimalLiteral, checked by hand (JS digits are ASCII only), then converted by Kotlin's correctly rounded parser. */
private fun parseDecimalLiteral(s: String): Double {
    var i = 0
    val sign = if (s[0] == '+' || s[0] == '-') s[i++].toString() else ""
    val intStart = i
    while (i < s.length && s[i] in '0'..'9') i++
    val intDigits = s.substring(intStart, i)
    var fractionDigits = ""
    if (i < s.length && s[i] == '.') {
        val fractionStart = ++i
        while (i < s.length && s[i] in '0'..'9') i++
        fractionDigits = s.substring(fractionStart, i)
    }
    if (intDigits.isEmpty() && fractionDigits.isEmpty()) return Double.NaN
    var exponent = ""
    if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
        val exponentStart = ++i
        if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
        val digitsStart = i
        while (i < s.length && s[i] in '0'..'9') i++
        if (i == digitsStart) return Double.NaN
        exponent = "e" + s.substring(exponentStart, i)
    }
    if (i != s.length) return Double.NaN
    // Rebuilt in the one form every Kotlin target parses: "5." and ".5" become "5.0" and "0.5".
    return "$sign${intDigits.ifEmpty { "0" }}.${fractionDigits.ifEmpty { "0" }}$exponent".toDouble()
}

/** ECMAScript WhiteSpace and LineTerminator: what `Number()` and `String.prototype.trim` strip. */
private fun isJsWhitespace(c: Char): Boolean = when (c) {
    '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0', '\u1680',
    '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
    -> true
    else -> c in '\u2000'..'\u200A'
}
