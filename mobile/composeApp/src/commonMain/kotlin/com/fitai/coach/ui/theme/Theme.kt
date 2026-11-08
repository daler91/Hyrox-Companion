package com.fitai.coach.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalFitaiColors = staticCompositionLocalOf { LightColors }
private val LocalFitaiTypography = staticCompositionLocalOf<FitaiTypography> {
    error("FitaiTypography read outside FitaiTheme")
}

/**
 * The app theme. Provides the brand tokens ([FitaiTheme.colors],
 * [FitaiTheme.typography]) and maps them onto Material 3, so stock Material
 * components (text fields, sheets, snackbars) already look on-brand.
 */
@Composable
fun FitaiTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors = if (darkTheme) DarkColors else LightColors
    val typography = fitaiTypography()
    CompositionLocalProvider(
        LocalFitaiColors provides colors,
        LocalFitaiTypography provides typography,
    ) {
        MaterialTheme(
            colorScheme = colors.toMaterial(),
            typography = typography.toMaterial(),
            shapes = Shapes(small = Radius.Sm, medium = Radius.Md, large = Radius.Lg, extraLarge = Radius.Xl),
            content = content,
        )
    }
}

object FitaiTheme {
    val colors: FitaiColors
        @Composable @ReadOnlyComposable
        get() = LocalFitaiColors.current

    val typography: FitaiTypography
        @Composable @ReadOnlyComposable
        get() = LocalFitaiTypography.current
}

private fun FitaiColors.toMaterial(): ColorScheme {
    val base = if (isDark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = primary,
        onPrimary = onPrimary,
        primaryContainer = accentSoft,
        onPrimaryContainer = onAccentSoft,
        secondary = accent,
        onSecondary = onAccent,
        secondaryContainer = muted,
        onSecondaryContainer = text,
        tertiary = accent,
        onTertiary = onAccent,
        background = background,
        onBackground = text,
        surface = background,
        onSurface = text,
        surfaceVariant = muted,
        onSurfaceVariant = textMuted,
        surfaceContainerLowest = background,
        surfaceContainerLow = surface,
        surfaceContainer = surface,
        surfaceContainerHigh = card,
        surfaceContainerHighest = muted,
        inverseSurface = text,
        inverseOnSurface = background,
        outline = borderStrong,
        outlineVariant = border,
        error = danger,
        onError = onDanger,
        scrim = base.scrim,
    )
}

private fun FitaiTypography.toMaterial(): Typography = Typography(
    displayLarge = display,
    displayMedium = h1,
    displaySmall = h2,
    headlineLarge = h1,
    headlineMedium = h2,
    headlineSmall = h3,
    titleLarge = h3,
    titleMedium = body.copy(fontWeight = button.fontWeight),
    titleSmall = button,
    bodyLarge = body,
    bodyMedium = bodySm,
    bodySmall = bodySm,
    labelLarge = button,
    labelMedium = bodySm,
    labelSmall = label,
)
