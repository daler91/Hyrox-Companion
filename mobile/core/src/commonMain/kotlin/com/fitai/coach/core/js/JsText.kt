package com.fitai.coach.core.js

import kotlin.math.abs

/*
 * JavaScript string semantics Kotlin's defaults do not reproduce, shared by
 * every port that trims input or prints numbers into text (unit labels,
 * fuelling explanations). Pinned by the js.trim and js.numberToString
 * fixture suites against real JS output.
 */

/**
 * `String.prototype.trim`: strips ECMAScript WhiteSpace and LineTerminator
 * code points. Kotlin's `trim()` uses a different set: it also strips
 * U+001C..U+001F, and it keeps U+FEFF, which JS strips.
 */
public fun jsTrim(text: String): String = text.trim { it.isJsWhitespace() }

private fun Char.isJsWhitespace(): Boolean = when (this) {
    '\u0009', '\u000A', '\u000B', '\u000C', '\u000D', '\u0020', '\u00A0', '\u1680',
    in '\u2000'..'\u200A', '\u2028', '\u2029', '\u202F', '\u205F', '\u3000', '\uFEFF',
    -> true
    else -> false
}

/**
 * `String(x)` for a number (ECMAScript Number::toString, radix 10): the
 * shortest digits that read back as [x], closest to it on a tie, printed
 * without an exponent for 1e-6 <= |x| < 1e21. So 1.0 prints `"1"`, 1e7
 * `"10000000"`, 1e21 `"1e+21"`, -0.0 `"0"`, where Kotlin prints `"1.0"`,
 * `"1.0E7"`, `"1.0E21"` and `"-0.0"`.
 */
public fun jsNumberToString(x: Double): String {
    if (x.isNaN()) return "NaN"
    if (x == 0.0) return "0"
    if (x.isInfinite()) return if (x > 0) "Infinity" else "-Infinity"
    val (digits, pointAt) = shortestDigits(abs(x))
    val text = formatEcmaDigits(digits, pointAt)
    return if (x < 0) "-$text" else text
}

/**
 * Number::toString step 5 onwards: [digits] are s (k digits, no trailing
 * zero) and [n] is where the decimal point goes, so the value is
 * s × 10^(n − k).
 */
private fun formatEcmaDigits(digits: String, n: Int): String {
    val k = digits.length
    return when {
        n in k..21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val e = n - 1
            val exponent = (if (e < 0) "-" else "+") + abs(e)
            if (k == 1) "${digits}e$exponent" else "${digits[0]}.${digits.substring(1)}e$exponent"
        }
    }
}

/**
 * The shortest significant digits s of a finite positive [x] such that
 * s × 10^(n − k) reads back as [x], choosing the candidate closest to [x]
 * (the even one on a tie) when two of the same length do, as V8 does.
 * Returns s without trailing zeros, and n.
 */
private fun shortestDigits(x: Double): Pair<String, Int> {
    val (exactDigits, scale) = exactDecimal(x)
    val n = exactDigits.length - scale
    val exact = exactDigits.trimEnd('0')
    for (p in 1..17) {
        if (exact.length <= p) return exact to n
        val low = exact.substring(0, p)
        val rest = exact.substring(p) // non-empty, last digit non-zero
        val high = incrementDigits(low)
        val highN = if (high.length > p) n + 1 else n
        val lowReadsBack = readsBackAs(low, n, x)
        val highReadsBack = readsBackAs(high, highN, x)
        val chooseHigh = when {
            lowReadsBack && highReadsBack -> when {
                rest[0] > '5' || (rest[0] == '5' && rest.length > 1) -> true
                rest == "5" -> (low.last() - '0') % 2 == 1 // a tie: the even candidate
                else -> false
            }
            highReadsBack -> true
            lowReadsBack -> false
            else -> continue
        }
        return if (chooseHigh) high.trimEnd('0') to highN else low.trimEnd('0') to n
    }
    return exact to n
}

/** Whether the decimal digits × 10^(n − digits.length) parse to exactly [x]. */
private fun readsBackAs(digits: String, n: Int, x: Double): Boolean =
    "${digits}E${n - digits.length}".toDouble() == x

/** A decimal digit string plus one ("129" → "130", "99" → "100"). */
private fun incrementDigits(digits: String): String {
    val chars = digits.toCharArray()
    var i = chars.size - 1
    while (i >= 0) {
        if (chars[i] == '9') {
            chars[i] = '0'
            i--
        } else {
            chars[i] = chars[i] + 1
            return chars.concatToString()
        }
    }
    return "1" + chars.concatToString()
}

/**
 * The exact value of a finite positive double as decimal digits and a
 * scale: x = digits × 10^-scale. A double is m × 2^e, which for e < 0 is
 * m × 5^-e / 10^-e exactly.
 */
private fun exactDecimal(x: Double): Pair<String, Int> {
    val bits = x.toRawBits()
    val exponentBits = ((bits ushr 52) and 0x7FF).toInt()
    val fraction = bits and 0xFFFFFFFFFFFFFL
    val mantissa = if (exponentBits == 0) fraction else fraction or (1L shl 52)
    val exponent = if (exponentBits == 0) -1074 else exponentBits - 1075
    var limbs = longToLimbs(mantissa)
    return if (exponent >= 0) {
        repeat(exponent) { limbs = multiplyLimbs(limbs, 2) }
        limbsToDecimal(limbs) to 0
    } else {
        repeat(-exponent) { limbs = multiplyLimbs(limbs, 5) }
        limbsToDecimal(limbs) to -exponent
    }
}

// A natural number as base-10^9 limbs, least significant first.
private const val LIMB_BASE = 1_000_000_000L

private fun longToLimbs(value: Long): LongArray {
    val out = ArrayList<Long>()
    var v = value
    do {
        out += v % LIMB_BASE
        v /= LIMB_BASE
    } while (v > 0)
    return out.toLongArray()
}

private fun multiplyLimbs(limbs: LongArray, factor: Int): LongArray {
    var carry = 0L
    val out = LongArray(limbs.size)
    for (i in limbs.indices) {
        val product = limbs[i] * factor + carry
        out[i] = product % LIMB_BASE
        carry = product / LIMB_BASE
    }
    return if (carry == 0L) out else out + carry
}

private fun limbsToDecimal(limbs: LongArray): String = buildString {
    append(limbs.last())
    for (i in limbs.size - 2 downTo 0) append(limbs[i].toString().padStart(9, '0'))
}
