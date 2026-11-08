package com.fitai.coach.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import kotlin.math.max
import kotlin.math.min
import kotlin.test.Test
import kotlin.test.assertTrue

/**
 * WCAG 2.2 AA contrast for every pair of tokens the components draw together,
 * in both themes: 4.5:1 for text (1.4.3), 3:1 for icons, focus rings and
 * form-field borders (1.4.11). Disabled controls are exempt, as WCAG allows.
 */
class ContrastTest {
    @Test
    fun textMeetsAaOnEverySurfaceItIsDrawnOn() = bothThemes { c ->
        val surfaces = listOf("background" to c.background, "surface" to c.surface, "card" to c.card, "muted" to c.muted)
        for ((name, surface) in surfaces) {
            text("text on $name", c.text, surface)
            text("textMuted on $name", c.textMuted, surface)
        }
        for ((name, surface) in surfaces.take(3)) {
            text("accentText on $name", c.accentText, surface)
            text("danger on $name", c.danger, surface)
            text("success on $name", c.success, surface)
            text("warning on $name", c.warning, surface)
        }
    }

    @Test
    fun filledControlsAndBadgesMeetAa() = bothThemes { c ->
        // Buttons and selected chips.
        text("onPrimary on primary", c.onPrimary, c.primary)
        text("onAccent on accent", c.onAccent, c.accent)
        text("onDanger on danger", c.onDanger, c.danger)
        text("onSuccess on success", c.onSuccess, c.success)
        text("onWarning on warning", c.onWarning, c.warning)
        // Badges (FitaiBadge): a 10% tint of the tone, on a card.
        text("neutral badge", c.textMuted, c.muted)
        text("accent badge", c.onAccentSoft, c.accentSoft)
        for ((name, tone) in listOf("success" to c.success, "warning" to c.warning, "danger" to c.danger)) {
            text("$name badge", tone, tone.copy(alpha = 0.1f).compositeOver(c.card))
        }
        // Toasts are the inverse surface, with the other theme's accent as the action.
        val toastAction = if (c.isDark) LightColors.accentText else DarkColors.accentText
        text("toast text", c.background, c.text)
        text("toast action", toastAction, c.text)
    }

    @Test
    fun bordersRingsAndIconsMeetThreeToOne() = bothThemes { c ->
        for ((name, surface) in listOf("background" to c.background, "surface" to c.surface, "card" to c.card)) {
            graphic("form-field border on $name", c.borderStrong, surface)
            graphic("focus ring on $name", c.ring, surface)
            graphic("error border on $name", c.danger, surface)
            graphic("accent icon on $name", c.accentText, surface)
        }
        graphic("form-field border on muted", c.borderStrong, c.muted)
    }

    private val failures = mutableListOf<String>()

    private fun bothThemes(check: (FitaiColors) -> Unit) {
        for (colors in listOf(LightColors, DarkColors)) {
            failures.clear()
            check(colors)
            val theme = if (colors.isDark) "dark" else "light"
            assertTrue(failures.isEmpty(), "$theme theme below WCAG AA:\n" + failures.joinToString("\n"))
        }
    }

    private fun text(name: String, foreground: Color, background: Color) = require(name, foreground, background, TEXT)

    private fun graphic(name: String, foreground: Color, background: Color) = require(name, foreground, background, NON_TEXT)

    private fun require(name: String, foreground: Color, background: Color, minimum: Double) {
        val ratio = contrast(foreground, background)
        if (ratio < minimum) failures += "  $name: ${(ratio * 100).toInt() / 100.0}:1, needs $minimum:1"
    }

    private companion object {
        const val TEXT = 4.5
        const val NON_TEXT = 3.0

        /** WCAG's contrast ratio: (lighter + 0.05) / (darker + 0.05) of the relative luminances. */
        fun contrast(a: Color, b: Color): Double {
            val la = a.luminance().toDouble()
            val lb = b.luminance().toDouble()
            return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)
        }
    }
}
