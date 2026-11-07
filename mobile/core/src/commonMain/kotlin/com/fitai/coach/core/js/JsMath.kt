package com.fitai.coach.core.js

import kotlin.math.abs
import kotlin.math.floor

/*
 * JavaScript number semantics that Kotlin's defaults do not reproduce, for
 * code ported from shared/ TypeScript that must give the same numbers as the
 * server and the web app (docs/mobile-shared-logic.md). Pinned to real JS
 * output by the `js.*` fixture suites.
 */

/**
 * `Math.round`: the nearest integer, halves rounded up (towards +∞), so
 * -2.5 → -2. Not `kotlin.math.round` (half to even: 2.5 → 2) and not
 * `x + 0.5` then floor (wrong for 0.49999999999999994).
 */
public fun jsRound(x: Double): Double {
    if (x.isNaN() || x.isInfinite()) return x
    val down = floor(x)
    return if (x - down >= 0.5) down + 1.0 else down
}

/**
 * `Number.prototype.toFixed(digits)` for |x| < 1e21 (JS switches to
 * exponent notation above that). JS rounds the double's exact binary value,
 * so 1.005.toFixed(2) is "1.00" (1.005 is stored as 1.00499999999999989…)
 * and 2.5.toFixed(0) is "3"; `String.format` and `roundToInt` differ on both.
 */
public fun jsToFixed(x: Double, digits: Int): String {
    require(digits in 0..100) { "toFixed digits must be 0..100" }
    require(!x.isNaN() && abs(x) < 1e21) { "jsToFixed supports finite |x| < 1e21, got $x" }
    val negative = x < 0.0
    val exact = ExactDecimal.of(abs(x))
    val rounded = exact.roundHalfUp(digits)
    val text = rounded.format(digits)
    // JS keeps the sign of a negative number even when it rounds to zero: (-0.0001).toFixed(2) is "-0.00".
    return if (negative) "-$text" else text
}

/**
 * The exact decimal value of a finite non-negative double, as a big natural
 * number of units of 10^-scale. A double is m·2^e; for e < 0 that is
 * m·5^-e / 10^-e exactly, so no precision is lost.
 */
private class ExactDecimal(private val digits: IntArray, private val scale: Int) {
    // digits: base-10^9 limbs, least significant first.

    fun roundHalfUp(fractionDigits: Int): ExactDecimal {
        if (scale <= fractionDigits) return this
        val drop = scale - fractionDigits
        val (quotient, remainderIsHalfOrMore) = divPow10(drop)
        val result = if (remainderIsHalfOrMore) addOne(quotient) else quotient
        return ExactDecimal(result, fractionDigits)
    }

    fun format(fractionDigits: Int): String {
        var text = toDecimalString(digits)
        val pad = fractionDigits - scale
        if (pad > 0) text += "0".repeat(pad)
        if (fractionDigits == 0) return text
        if (text.length <= fractionDigits) text = "0".repeat(fractionDigits - text.length + 1) + text
        return text.substring(0, text.length - fractionDigits) + "." + text.substring(text.length - fractionDigits)
    }

    /** this / 10^n as an integer, and whether the remainder is at least half of 10^n. */
    private fun divPow10(n: Int): Pair<IntArray, Boolean> {
        val text = toDecimalString(digits)
        if (n >= text.length) {
            val padded = "0".repeat(n - text.length) + text
            return intArrayOf(0) to (padded[0] >= '5')
        }
        val head = text.substring(0, text.length - n)
        val tail = text.substring(text.length - n)
        return fromDecimalString(head) to (tail[0] >= '5')
    }

    companion object {
        private const val BASE = 1_000_000_000

        fun of(x: Double): ExactDecimal {
            if (x == 0.0) return ExactDecimal(intArrayOf(0), 0)
            val bits = x.toRawBits()
            val exponentBits = ((bits ushr 52) and 0x7FF).toInt()
            val fraction = bits and 0xFFFFFFFFFFFFFL
            val mantissa = if (exponentBits == 0) fraction else fraction or (1L shl 52)
            val exponent = if (exponentBits == 0) -1074 else exponentBits - 1075
            var limbs = fromLong(mantissa)
            return if (exponent >= 0) {
                repeat(exponent) { limbs = multiplySmall(limbs, 2) }
                ExactDecimal(limbs, 0)
            } else {
                repeat(-exponent) { limbs = multiplySmall(limbs, 5) }
                ExactDecimal(limbs, -exponent)
            }
        }

        private fun fromLong(value: Long): IntArray {
            val out = ArrayList<Int>()
            var v = value
            do {
                out += (v % BASE).toInt()
                v /= BASE
            } while (v > 0)
            return out.toIntArray()
        }

        private fun multiplySmall(limbs: IntArray, factor: Int): IntArray {
            val out = IntArray(limbs.size + 1)
            var carry = 0L
            for (i in limbs.indices) {
                val product = limbs[i].toLong() * factor + carry
                out[i] = (product % BASE).toInt()
                carry = product / BASE
            }
            out[limbs.size] = carry.toInt()
            return trim(out)
        }

        private fun addOne(limbs: IntArray): IntArray {
            val out = limbs.copyOf(limbs.size + 1)
            var i = 0
            while (true) {
                out[i] += 1
                if (out[i] < BASE) break
                out[i] = 0
                i++
            }
            return trim(out)
        }

        private fun trim(limbs: IntArray): IntArray {
            var size = limbs.size
            while (size > 1 && limbs[size - 1] == 0) size--
            return if (size == limbs.size) limbs else limbs.copyOf(size)
        }

        private fun toDecimalString(limbs: IntArray): String = buildString {
            append(limbs.last())
            for (i in limbs.size - 2 downTo 0) append(limbs[i].toString().padStart(9, '0'))
        }

        private fun fromDecimalString(text: String): IntArray {
            val out = ArrayList<Int>()
            var end = text.length
            while (end > 0) {
                val start = maxOf(0, end - 9)
                out += text.substring(start, end).toInt()
                end = start
            }
            return trim(out.toIntArray())
        }
    }
}
