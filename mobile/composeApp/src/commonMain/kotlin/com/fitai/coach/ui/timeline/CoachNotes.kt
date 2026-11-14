package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineCoachNotes
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * A session's notes split into the athlete's text and the coach's cues, as
 * the server sends them. A cached entry from before it did shows its notes
 * as the athlete's text until the next refresh; null with no notes at all.
 */
fun coachNotesOf(entry: TimelineEntry): TimelineCoachNotes? = entry.coachNotes
    ?: entry.notes?.trim()?.takeIf { it.isNotEmpty() }?.let { TimelineCoachNotes(athleteText = it, cues = emptyList()) }

/** "Pacing: hold 5:30/km", the label in [emphasis] (WorkoutNotes' cue rows). */
fun cueText(cue: TimelineCoachNotes.CuesItem, emphasis: Color): AnnotatedString = buildAnnotatedString {
    cue.label?.let { label ->
        withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = emphasis)) { append("$label: ") }
    }
    append(cue.text)
}

/**
 * A card's notes (WorkoutNotes): what the athlete wrote, in italics, then
 * the coach's cues, each once, under "Coach cues".
 */
@Composable
fun CardNotes(notes: TimelineCoachNotes) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        if (notes.athleteText.isNotBlank()) {
            Text(
                notes.athleteText,
                style = FitaiTheme.typography.bodySm.copy(fontStyle = FontStyle.Italic),
                color = colors.textMuted,
            )
        }
        if (notes.cues.isNotEmpty()) CoachCues(notes.cues)
    }
}

/** The coach's cues under their heading, one per line. */
@Composable
fun CoachCues(cues: List<TimelineCoachNotes.CuesItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalAlignment = Alignment.CenterVertically) {
            Icon(LucideIcons.Sparkles, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(12.dp))
            Text("Coach cues", style = type.label, color = colors.textMuted, modifier = Modifier.semantics { heading() })
        }
        cues.forEach { cue ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Text("•", style = type.bodySm, color = colors.textMuted)
                Text(cueText(cue, colors.text), style = type.bodySm, color = colors.textMuted)
            }
        }
    }
}
