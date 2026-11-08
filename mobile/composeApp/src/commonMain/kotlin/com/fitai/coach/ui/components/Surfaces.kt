package com.fitai.coach.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * A card: paper, a 1 dp border, 12 dp corners, 20 dp padding, and no shadow
 * (brand kit §6). Tappable when [onClick] is set.
 */
@Composable
fun FitaiCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    val colors = FitaiTheme.colors
    val border = BorderStroke(1.dp, colors.border)
    val body: @Composable () -> Unit = { Column(Modifier.padding(Spacing.Xl), content = content) }
    if (onClick != null) {
        Surface(onClick = onClick, modifier = modifier, shape = Radius.Lg, color = colors.card, border = border, content = body)
    } else {
        Surface(modifier = modifier, shape = Radius.Lg, color = colors.card, border = border, content = body)
    }
}

enum class BadgeTone { Neutral, Accent, Success, Warning, Danger }

/** A small uppercase status label (brand kit §6). */
@Composable
fun FitaiBadge(text: String, modifier: Modifier = Modifier, tone: BadgeTone = BadgeTone.Neutral) {
    val colors = FitaiTheme.colors
    val (container, content) = when (tone) {
        BadgeTone.Neutral -> colors.muted to colors.textMuted
        BadgeTone.Accent -> colors.accentSoft to colors.onAccentSoft
        BadgeTone.Success -> colors.success.copy(alpha = 0.1f) to colors.success
        BadgeTone.Warning -> colors.warning.copy(alpha = 0.1f) to colors.warning
        BadgeTone.Danger -> colors.danger.copy(alpha = 0.1f) to colors.danger
    }
    Surface(modifier = modifier, shape = Radius.Sm, color = container, contentColor = content) {
        Text(
            text = text.uppercase(),
            style = FitaiTheme.typography.label,
            modifier = Modifier.padding(horizontal = Spacing.Sm, vertical = Spacing.Xxs),
        )
    }
}

/** A selectable filter chip. */
@Composable
fun FitaiChip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val colors = FitaiTheme.colors
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, style = FitaiTheme.typography.bodySm) },
        modifier = modifier,
        enabled = enabled,
        shape = Radius.Md,
        colors = FilterChipDefaults.filterChipColors(
            containerColor = colors.background,
            labelColor = colors.text,
            selectedContainerColor = colors.primary,
            selectedLabelColor = colors.onPrimary,
        ),
        border = FilterChipDefaults.filterChipBorder(
            enabled = enabled,
            selected = selected,
            borderColor = colors.borderStrong,
            selectedBorderColor = colors.primary,
        ),
    )
}
