package com.fitai.coach.ui.timeline

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.exercises.isRunningExerciseName
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * The MAF ceiling to show on [entry] (MafCeilingChip): a planned session with
 * running in its sets, for an athlete who trains to [ceiling]. Read from the
 * sets, not the focus, which is free text: a text-only run gets no chip
 * rather than a strength day getting one.
 */
fun mafCeilingFor(entry: TimelineEntry, ceiling: Int?): Int? = ceiling?.takeIf {
    entry.status == TimelineEntry.Status.Planned &&
        entry.planDayId != null &&
        entry.exerciseSets.orEmpty().any { set -> isRunningExerciseName(set.exerciseName) }
}

/** What the chip reads out (the web's tooltip). */
fun mafCeilingExplanation(ceiling: Int): String =
    "Your MAF aerobic ceiling is $ceiling bpm. Hold at or under it for this run — it's a ceiling to stay below, not a target to chase."

/** "MAF ceiling 142 bpm" on a planned run, the number emphasised. */
@Composable
fun MafCeilingChip(ceiling: Int) {
    val colors = FitaiTheme.colors
    Row(
        Modifier
            .clearAndSetSemantics { contentDescription = mafCeilingExplanation(ceiling) }
            .border(1.dp, colors.border, Radius.Md)
            .background(colors.card, Radius.Md)
            .padding(horizontal = Spacing.Sm, vertical = Spacing.Xxs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        Icon(LucideIcons.HeartPulse, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
        Text(
            buildAnnotatedString {
                append("MAF ceiling ")
                withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = colors.text)) { append("$ceiling") }
                append(" bpm")
            },
            style = FitaiTheme.typography.caption,
            color = colors.textMuted,
        )
    }
}

/** A card whose changes are still waiting to go to the server (the web's "Pending sync" badge). */
@Composable
fun PendingSyncBadge() {
    FitaiBadge("Pending sync", tone = BadgeTone.Warning, icon = LucideIcons.CloudUpload)
}
