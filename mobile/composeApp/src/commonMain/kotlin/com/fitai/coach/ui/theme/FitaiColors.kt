package com.fitai.coach.ui.theme

import androidx.compose.runtime.Immutable
import androidx.compose.ui.graphics.Color

/**
 * The fitai.coach palette (docs/BrandKit/BRAND.md §3), as the web renders it:
 * every value is the HSL token in client/src/index.css converted to sRGB. That
 * includes the web's WCAG adjustments (muted text, success and warning as text,
 * input borders), which deliberately depart from the brand kit's swatches.
 *
 * Lime is #B1F584, from `hsl(96 85% 74%)`: what the web and the logo files
 * draw. The brand kit's swatch table lists #C4F37E beside that same HSL, but
 * nothing renders it.
 */
@Immutable
data class FitaiColors(
    val background: Color,
    val surface: Color,
    val card: Color,
    val muted: Color,
    val border: Color,
    val borderStrong: Color,
    val text: Color,
    val textMuted: Color,
    val primary: Color,
    val onPrimary: Color,
    val accent: Color,
    val onAccent: Color,
    val accentSoft: Color,
    val onAccentSoft: Color,
    val danger: Color,
    val onDanger: Color,
    val success: Color,
    val onSuccess: Color,
    val warning: Color,
    val onWarning: Color,
    val ring: Color,
    val isDark: Boolean,
)

private val Ink = Color(0xFF0A0A0A)
private val Paper = Color(0xFFFFFFFF)
private val Lime = Color(0xFFB1F584)
private val Danger = Color(0xFFEF4343)

val LightColors = FitaiColors(
    background = Paper,
    surface = Color(0xFFFAFAFA),
    card = Paper,
    muted = Color(0xFFF5F5F5),
    border = Color(0xFFF0F0F0),
    // --input: the 3:1 border for form fields (WCAG 1.4.11).
    borderStrong = Color(0xFFA6A6A6),
    text = Ink,
    // 4.6:1 on white (WCAG 1.4.3 AA).
    textMuted = Color(0xFF737373),
    primary = Ink,
    onPrimary = Paper,
    accent = Lime,
    onAccent = Ink,
    accentSoft = Color(0xFFEEF9E7),
    onAccentSoft = Color(0xFF365F1B),
    danger = Danger,
    onDanger = Paper,
    success = Color(0xFF147638),
    onSuccess = Paper,
    warning = Color(0xFFAA5909),
    onWarning = Paper,
    ring = Ink,
    isDark = false,
)

/** Dark mode: lime takes over as the primary CTA (brand kit §3). */
val DarkColors = FitaiColors(
    background = Ink,
    surface = Color(0xFF141414),
    card = Color(0xFF141414),
    muted = Color(0xFF1C1C1C),
    border = Color(0xFF262626),
    borderStrong = Color(0xFF616161),
    text = Color(0xFFF5F5F5),
    textMuted = Color(0xFF858585),
    primary = Lime,
    onPrimary = Ink,
    accent = Lime,
    onAccent = Ink,
    accentSoft = Color(0xFF1C1C1C),
    onAccentSoft = Lime,
    danger = Danger,
    onDanger = Paper,
    success = Color(0xFF21C45D),
    onSuccess = Ink,
    warning = Color(0xFFFBD350),
    onWarning = Ink,
    ring = Lime,
    isDark = true,
)

/** Data-viz series colours, in order (azure, teal, amber, coral, violet). Never UI chrome. */
val DataColors = listOf(
    Color(0xFF1E84F1),
    Color(0xFF00B881),
    Color(0xFFF6A123),
    Color(0xFFE74B60),
    Color(0xFF895AF6),
)
