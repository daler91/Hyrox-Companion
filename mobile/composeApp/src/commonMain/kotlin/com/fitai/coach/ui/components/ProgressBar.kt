package com.fitai.coach.ui.components

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.theme.FitaiTheme

/**
 * How far along a target something is: a thin bar that fills from the left,
 * amber once [over] the target. Plain at both ends, as the web's bars are:
 * Material's gap and end dot read as a second mark on a bar this small. The
 * figures beside it say the amount; the bar is not the only place it shows.
 */
@Composable
fun FitaiProgressBar(fraction: Float, modifier: Modifier = Modifier, over: Boolean = false, track: Color = FitaiTheme.colors.muted) {
    LinearProgressIndicator(
        progress = { fraction.coerceIn(0f, 1f) },
        modifier = modifier.fillMaxWidth(),
        color = if (over) FitaiTheme.colors.warning else FitaiTheme.colors.primary,
        trackColor = track,
        gapSize = 0.dp,
        drawStopIndicator = {},
    )
}
