package com.fitai.coach.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.graphics.compositeOver
import androidx.compose.ui.graphics.takeOrElse
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fitai.coach.ui.theme.ChipColors
import com.fitai.coach.ui.theme.FitaiColors
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.theme.categoryChipColors

/** What a card's tint says about its content; [Plain] is the paper card. */
enum class CardTone { Plain, Success, Warning }

/** How strongly a toned card's colour tints its paper, and its border. */
const val CARD_TONE_FILL = 0.05f
private const val TONE_BORDER = 0.3f

/**
 * A card: paper, a 1 dp border, 12 dp corners, 20 dp padding unless
 * [contentPadding] says otherwise, and no shadow (brand kit §6). Tappable
 * when [onClick] is set. A [tone] tints the paper and
 * the border, as the web's timeline cards are by status; the words on the card
 * still say what it means.
 */
@Composable
fun FitaiCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    tone: CardTone = CardTone.Plain,
    contentPadding: Dp = Spacing.Xl,
    content: @Composable ColumnScope.() -> Unit,
) {
    val colors = FitaiTheme.colors
    val tint = when (tone) {
        CardTone.Plain -> null
        CardTone.Success -> colors.success
        CardTone.Warning -> colors.warning
    }
    val container = tint?.copy(alpha = CARD_TONE_FILL)?.compositeOver(colors.card) ?: colors.card
    val border = BorderStroke(1.dp, tint?.copy(alpha = TONE_BORDER)?.compositeOver(colors.card) ?: colors.border)
    val body: @Composable () -> Unit = { Column(Modifier.padding(contentPadding), content = content) }
    if (onClick != null) {
        Surface(onClick = onClick, modifier = modifier, shape = Radius.Lg, color = container, border = border, content = body)
    } else {
        Surface(modifier = modifier, shape = Radius.Lg, color = container, border = border, content = body)
    }
}

/**
 * What a badge says about its content. [Secondary] is a filled neutral label
 * in full-strength text (a card's weekday); [Outline] has a border and no fill
 * (a plan's name, the plan week); [Info] is the blue of a session still to do.
 */
enum class BadgeTone { Neutral, Accent, Success, Warning, Danger, Info, Secondary, Outline }

/** How strongly a badge's colour tints its fill (the web's `/10`). */
const val BADGE_TINT = 0.1f

/** A badge's fill and the text on it, as the web's Badge is coloured by use. */
fun badgeColors(tone: BadgeTone, colors: FitaiColors): ChipColors {
    fun tinted(color: Color) = ChipColors(color.copy(alpha = BADGE_TINT), color)
    return when (tone) {
        BadgeTone.Neutral -> ChipColors(colors.muted, colors.textMuted)
        BadgeTone.Secondary -> ChipColors(colors.muted, colors.text)
        BadgeTone.Outline -> ChipColors(Color.Transparent, colors.text)
        BadgeTone.Accent -> tinted(colors.accentText)
        BadgeTone.Success -> tinted(colors.success)
        BadgeTone.Warning -> tinted(colors.warning)
        BadgeTone.Danger -> tinted(colors.danger)
        BadgeTone.Info -> categoryChipColors("running", colors)
    }
}

private val BadgeShape = RoundedCornerShape(6.dp)
private val BadgePadding = 10.dp

private val BadgeIcon = 12.sp

/** With the text's 16 sp line, the web badge's 22 px. */
private val BadgeVerticalPadding = 3.dp

/**
 * A small status label, drawn as the web's Badge: sentence case, semibold,
 * 6 dp corners, one line, with an optional [icon] ahead of the words. A long
 * one (a plan's name) is cut short with an ellipsis rather than wrapped.
 * [contentColor] overrides the tone's text colour, for an outline badge in
 * muted or accent text.
 */
@Composable
fun FitaiBadge(
    text: String,
    modifier: Modifier = Modifier,
    tone: BadgeTone = BadgeTone.Neutral,
    icon: ImageVector? = null,
    contentColor: Color = Color.Unspecified,
) {
    val colors = FitaiTheme.colors
    val badge = badgeColors(tone, colors)
    Surface(
        modifier = modifier,
        shape = BadgeShape,
        color = badge.container,
        contentColor = contentColor.takeOrElse { badge.content },
        border = if (tone == BadgeTone.Outline) BorderStroke(1.dp, colors.border) else null,
    ) {
        Row(
            Modifier.padding(horizontal = BadgePadding, vertical = BadgeVerticalPadding),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            // Sized in the text's unit, so it grows with the words at a larger font size.
            icon?.let { Icon(it, contentDescription = null, modifier = Modifier.size(with(LocalDensity.current) { BadgeIcon.toDp() })) }
            Text(
                text,
                style = FitaiTheme.typography.caption.copy(fontWeight = FontWeight.SemiBold),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/** A selectable filter chip; [shape] makes it a pill where the web's is one. */
@Composable
fun FitaiChip(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    shape: Shape = Radius.Md,
) {
    val colors = FitaiTheme.colors
    FilterChip(
        selected = selected,
        onClick = onClick,
        label = { Text(label, style = FitaiTheme.typography.bodySm) },
        modifier = modifier,
        enabled = enabled,
        shape = shape,
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
