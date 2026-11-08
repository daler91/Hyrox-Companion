package com.fitai.coach.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme

/**
 * The Nexus mark (brand kit §2): three connected nodes on a lime container
 * with 22% corners. The top node (the athlete) is hollow; coach and AI are
 * solid. Drawn on the same 96-unit grid as docs/BrandKit/logo-primary.svg.
 */
@Composable
fun NexusMark(modifier: Modifier = Modifier, size: Dp = 32.dp) {
    val lime = FitaiTheme.colors.accent
    val ink = FitaiTheme.colors.onAccent
    Canvas(modifier.size(size).semantics { contentDescription = "fitai.coach" }) {
        val unit = this.size.minDimension / 96f
        fun p(x: Float, y: Float) = Offset(x * unit, y * unit)
        drawRoundRect(color = lime, cornerRadius = CornerRadius(21f * unit))
        val stroke = 5f * unit
        drawLine(ink, p(24f, 72f), p(72f, 72f), stroke, StrokeCap.Round)
        drawLine(ink, p(24f, 72f), p(48f, 26f), stroke, StrokeCap.Round)
        drawLine(ink, p(72f, 72f), p(48f, 26f), stroke, StrokeCap.Round)
        drawCircle(ink, 8f * unit, p(24f, 72f))
        drawCircle(ink, 8f * unit, p(72f, 72f))
        drawCircle(ink, 10f * unit, p(48f, 26f))
        drawCircle(lime, 4f * unit, p(48f, 26f))
    }
}
