package com.fitai.coach.core.nutrition

/*
 * JS `String(n)` / template-literal number formatting (ECMAScript
 * Number::toString), for the explanation strings of computeSessionFuellingTarget.
 * Kotlin prints 1.0 and 1.0E7 where JS prints 1 and 10000000.
 *
 * Internal here because JsMath.kt, its natural home beside jsRound and
 * jsToFixed, belongs to the fixture harness; unitConversion and
 * units.formatMinutes need the same helper (docs/mobile-shared-logic.md).
 * Pinned through the `sessionFuellingTargets.computeSessionFuellingTarget`
 * fixtures, which format integers, decimals, 1e-7, 1e+21, subnormals,
 * NaN and Infinity.
 */

/**
 * `String(x)` as JavaScript writes it: shortest round-trip digits, plain
 * notation for 1e-6 <= |x| < 1e21 ("0.000001", "123456789012345680000"),
 * exponent notation outside it ("5e-7", "1e+21", "1.5e+300"), "0" for -0,
 * and "NaN", "Infinity", "-Infinity".
 */
internal fun jsNumberToString(x: Double): String {
    if (x.isNaN()) return "NaN"
    if (x == Double.POSITIVE_INFINITY) return "Infinity"
    if (x == Double.NEGATIVE_INFINITY) return "-Infinity"
    if (x == 0.0) return "0" // -0 too
    if (x < 0.0) return "-" + jsNumberToString(-x)

    // x = 0.<digits> × 10^n, digits as few as round-trip (k = digits.length).
    val (digits, n) = shortestDigits(x)
    val k = digits.length
    return when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val exponent = n - 1
            val sign = if (exponent >= 0) "+" else "-"
            val mantissa = if (k == 1) digits else digits.substring(0, 1) + "." + digits.substring(1)
            "${mantissa}e$sign${if (exponent >= 0) exponent else -exponent}"
        }
    }
}

/** A positive decimal 0.[digits] × 10^[n], [digits] without leading or trailing zeros. */
private data class Decimal(val digits: String, val n: Int) {
    fun toDouble(): Double = "0.${digits}e$n".toDouble()
}

/**
 * The shortest digit string that reads back as [x], the closest to [x] when
 * there are two (ECMAScript Number::toString, step 5).
 *
 * Starts from the platform's `Double.toString`, which on the JVM (JDK 19+)
 * and in JS is already the shortest round-trip form, then tries every
 * shorter length: the JVM keeps a second digit when the length-1 decimal is
 * not the nearest (it prints 4.9E-324 where JS prints 5e-324), and a
 * platform whose `toString` is not shortest is corrected the same way.
 */
private fun shortestDigits(x: Double): Decimal {
    val printed = parseDecimal(x.toString())
    for (length in 1 until printed.digits.length) {
        val down = truncate(printed, length)
        val up = roundUp(printed, length)
        val downOk = down.toDouble() == x
        val upOk = up.toDouble() == x
        if (downOk && upOk) return if (preferUp(printed, length)) up else down
        if (downOk) return down
        if (upOk) return up
    }
    return printed
}

/** Parses "123.45", "1.0E-7", "1e+21" and the like into a [Decimal]. */
private fun parseDecimal(text: String): Decimal {
    val e = text.indexOfFirst { it == 'E' || it == 'e' }
    val mantissa = if (e < 0) text else text.substring(0, e)
    val exponent = if (e < 0) 0 else text.substring(e + 1).removePrefix("+").toInt()
    val point = mantissa.indexOf('.')
    val integerPart = if (point < 0) mantissa else mantissa.substring(0, point)
    val all = integerPart + (if (point < 0) "" else mantissa.substring(point + 1))
    val leadingZeros = all.indexOfFirst { it != '0' }
    return Decimal(all.substring(leadingZeros).trimEnd('0'), integerPart.length + exponent - leadingZeros)
}

/** The first [length] digits, rounded down. */
private fun truncate(d: Decimal, length: Int): Decimal = normalize(d.digits.substring(0, length), d.n)

/** The first [length] digits plus one unit in the last place (999 → 1000, one more power of ten). */
private fun roundUp(d: Decimal, length: Int): Decimal {
    val head = d.digits.substring(0, length).toCharArray()
    var i = length - 1
    while (i >= 0 && head[i] == '9') {
        head[i] = '0'
        i--
    }
    if (i < 0) return normalize("1" + head.concatToString(), d.n + 1)
    head[i] = head[i] + 1
    return normalize(head.concatToString(), d.n)
}

private fun normalize(digits: String, n: Int): Decimal = Decimal(digits.trimEnd('0'), n)

/**
 * Whether rounding up to [length] digits lands nearer than truncating: the
 * dropped digits are more than half a unit, or exactly half and the truncated
 * last digit is odd (on a tie ECMAScript picks the even digit string).
 */
private fun preferUp(d: Decimal, length: Int): Boolean {
    val dropped = d.digits.substring(length)
    return when {
        dropped[0] > '5' -> true
        dropped[0] < '5' -> false
        dropped.length > 1 -> true
        else -> (d.digits[length - 1] - '0') % 2 == 1
    }
}
