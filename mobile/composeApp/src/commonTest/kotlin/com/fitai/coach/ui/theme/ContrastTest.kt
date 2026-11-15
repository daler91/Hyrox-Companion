package com.fitai.coach.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.luminance
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.CARD_TONE_FILL
import com.fitai.coach.ui.components.badgeColors
import com.fitai.coach.ui.timeline.COACH_NOTE_TINT
import com.fitai.coach.ui.timeline.LINK_PROMPT_TINT
import com.fitai.coach.ui.timeline.StravaOrange
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
        // Badges (FitaiBadge), every tone: a neutral fill or a 10% tint of the tone, on a card or the page.
        for (tone in BadgeTone.entries) {
            val badge = badgeColors(tone, c)
            for ((name, surface) in listOf("card" to c.card, "background" to c.background)) {
                text("$tone badge on $name", badge.content, badge.container.compositeOver(surface))
            }
        }
        // An outline badge in muted text (a plan's name) or the accent (today's plan week), on the page and a card.
        text("muted outline badge", c.textMuted, c.card)
        text("accent outline badge", c.accentText, c.background)
        // Toasts are the inverse surface, with the other theme's accent as the action.
        val toastAction = if (c.isDark) LightColors.accentText else DarkColors.accentText
        text("toast text", c.background, c.text)
        text("toast action", toastAction, c.text)
    }

    @Test
    fun exerciseChipsMeetAaOnEveryCardTheySitOn() = bothThemes { c ->
        // A timeline card is plain, or tinted green when done and amber when missed; the chip's own tint lies over that.
        val cards = listOf(
            "plain" to c.card,
            "completed" to c.success.copy(alpha = CARD_TONE_FILL).compositeOver(c.card),
            "missed" to c.warning.copy(alpha = CARD_TONE_FILL).compositeOver(c.card),
        )
        for (category in EXERCISE_CATEGORIES + "other") {
            val chip = categoryChipColors(category, c)
            for ((name, card) in cards) text("$category chip on a $name card", chip.content, chip.container.compositeOver(card))
        }
        // The muted lines on a toned card: its plan line, notes and recording figures.
        for ((name, card) in cards) text("textMuted on a $name card", c.textMuted, card)
    }

    @Test
    fun badgesAndTheLinkPromptMeetAaOnATonedCard() = bothThemes { c ->
        val completed = c.success.copy(alpha = CARD_TONE_FILL).compositeOver(c.card)
        val missed = c.warning.copy(alpha = CARD_TONE_FILL).compositeOver(c.card)
        // A badge's own fill lies over the card's tint; any tone can sit on either card (status, tier, Strava, weekday).
        for (tone in BadgeTone.entries) {
            val badge = badgeColors(tone, c)
            text("$tone badge on a completed card", badge.content, badge.container.compositeOver(completed))
            text("$tone badge on a missed card", badge.content, badge.container.compositeOver(missed))
        }
        // "Was this your …?" on a recording's card, with its two answers.
        val prompt = StravaOrange.copy(alpha = LINK_PROMPT_TINT).compositeOver(completed)
        text("link prompt question and its answers", c.text, prompt)
    }

    @Test
    fun theCoachsNoteMeetsAaOnEveryCardAndInASheet() = bothThemes { c ->
        val cards = listOf(
            "plain card" to c.card,
            "completed card" to c.success.copy(alpha = CARD_TONE_FILL).compositeOver(c.card),
            "missed card" to c.warning.copy(alpha = CARD_TONE_FILL).compositeOver(c.card),
            // "Why this workout" in a session's sheet, which is the page colour.
            "sheet" to c.background,
        )
        for ((name, card) in cards) {
            val note = c.accentText.copy(alpha = COACH_NOTE_TINT).compositeOver(card)
            text("coach's note title on a $name", c.accentText, note)
            text("coach's note date and text on a $name", c.text, note)
            // The chips it lists what it went on with, inside the note.
            val chip = badgeColors(BadgeTone.Secondary, c)
            text("coach's note chip on a $name", chip.content, chip.container.compositeOver(note))
        }
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
