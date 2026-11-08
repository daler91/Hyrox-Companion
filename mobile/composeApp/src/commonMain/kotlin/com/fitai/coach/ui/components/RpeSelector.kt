package com.fitai.coach.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val MAX_RPE = 10

/** The effort band the web labels each RPE with. */
fun rpeLabel(rpe: Int): String = when (rpe) {
    in 1..3 -> "Easy"
    in 4..6 -> "Moderate"
    in 7..8 -> "Hard"
    else -> "Max effort"
}

/** RPE 1–10 as chips; tapping the selected one clears it. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RpeSelector(value: Int?, onChange: (Int?) -> Unit, modifier: Modifier = Modifier) {
    val haptics = LocalHapticFeedback.current
    Column(modifier, verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            for (rpe in 1..MAX_RPE) {
                FitaiChip(label = rpe.toString(), selected = value == rpe, onClick = {
                    haptics.performHapticFeedback(HapticFeedbackType.SegmentTick)
                    onChange(if (value == rpe) null else rpe)
                })
            }
        }
        Text(
            value?.let { "RPE $it · ${rpeLabel(it)}" } ?: "How hard was it? (optional)",
            style = FitaiTheme.typography.bodySm,
            color = FitaiTheme.colors.textMuted,
        )
    }
}
