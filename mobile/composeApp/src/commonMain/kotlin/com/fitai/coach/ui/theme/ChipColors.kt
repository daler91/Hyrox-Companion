package com.fitai.coach.ui.theme

import androidx.compose.ui.graphics.Color

/** A chip's fill and the text drawn on it. */
data class ChipColors(val container: Color, val content: Color)

/** How strongly a category's colour tints its chip (the web's `/10`). */
const val CATEGORY_CHIP_TINT = 0.1f

/**
 * An exercise chip's colours by category, as the web's timeline shows them
 * (categoryChipColors): orange for functional, blue for running, purple for
 * strength, red for conditioning, each a soft tint under text of the same
 * hue. The text is a shade darker than the web's in the light theme, where
 * the web's falls short of AA on the tint. Anything else is neutral.
 */
@Suppress("MagicNumber") // The palette itself.
fun categoryChipColors(category: String?, colors: FitaiColors): ChipColors {
    val (tint, onLight, onDark) = when (category) {
        "functional" -> Triple(Color(0xFFF97316), Color(0xFF9A3412), Color(0xFFFB923C))
        "running" -> Triple(Color(0xFF3B82F6), Color(0xFF1D4ED8), Color(0xFF60A5FA))
        "strength" -> Triple(Color(0xFFA855F7), Color(0xFF7E22CE), Color(0xFFC084FC))
        "conditioning" -> Triple(Color(0xFFEF4444), Color(0xFFB91C1C), Color(0xFFF87171))
        else -> return ChipColors(colors.muted, colors.text)
    }
    return ChipColors(tint.copy(alpha = CATEGORY_CHIP_TINT), if (colors.isDark) onDark else onLight)
}

/** The categories with a colour of their own. */
val EXERCISE_CATEGORIES = listOf("functional", "running", "strength", "conditioning")
