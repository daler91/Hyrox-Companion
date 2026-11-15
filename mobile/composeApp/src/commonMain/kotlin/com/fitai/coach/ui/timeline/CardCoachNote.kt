package com.fitai.coach.ui.timeline

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.RoundRect
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.geometry.toRect
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** How strongly the coach's note is tinted in the accent, over its card (the web's `bg-primary/5`). */
const val COACH_NOTE_TINT = 0.05f
private const val COACH_NOTE_RULE = 0.6f
private val RULE_WIDTH = 2.dp
private val NOTE_CORNER = 8.dp

/**
 * The coach's note on a card (CoachNote.tsx): one closed line, "Coach's note
 * · updated 3 days ago", that opens to why the session looks as it does, what
 * an auto-progression moved, what it replaced, and what the coach went on.
 * Opening it doesn't open the card.
 */
@Composable
fun CardCoachNote(entry: TimelineEntry, rationale: String, today: String?) {
    var open by rememberSaveable(entry.id) { mutableStateOf(false) }
    val colors = FitaiTheme.colors
    val accent = colors.accentText
    Column(
        // Drawn clipped rather than laid out clipped: a clip on the box would also cut the one-line toggle's touch target to the box.
        Modifier.fillMaxWidth().drawBehind {
            val box = Path().apply { addRoundRect(RoundRect(size.toRect(), CornerRadius(NOTE_CORNER.toPx()))) }
            clipPath(box) {
                drawRect(accent.copy(alpha = COACH_NOTE_TINT))
                drawRect(accent.copy(alpha = COACH_NOTE_RULE), size = Size(RULE_WIDTH.toPx(), size.height))
            }
        },
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = { open = !open })
                .semantics { stateDescription = if (open) "Expanded" else "Collapsed" }
                .padding(horizontal = Spacing.Md, vertical = Spacing.Sm),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            val chevron = if (open) LucideIcons.ChevronDown else LucideIcons.ChevronRight
            Icon(chevron, contentDescription = null, tint = accent, modifier = Modifier.size(12.dp))
            Icon(LucideIcons.Sparkles, contentDescription = null, tint = accent, modifier = Modifier.size(12.dp))
            Text(
                buildAnnotatedString {
                    withStyle(SpanStyle(color = accent, fontWeight = FontWeight.Medium)) { append("Coach's note") }
                    updatedAgo(entry.aiNoteUpdatedAt, today)?.let { append(" · updated $it") }
                },
                style = FitaiTheme.typography.caption,
                // The web's muted grey falls short of AA on the note's tint over a toned card, so the date is in the text colour.
                color = colors.text,
            )
        }
        if (open) CoachNoteBody(entry, rationale)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun CoachNoteBody(entry: TimelineEntry, rationale: String) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val inputs = entry.aiInputsUsed
    Column(
        Modifier.padding(start = Spacing.Md, end = Spacing.Md, bottom = Spacing.Sm),
        verticalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        Text(rationale, style = type.bodySm, color = colors.text)
        progressionChanges(inputs).forEach { Text(it, style = type.caption, color = colors.text) }
        inputs?.replacedPrescription?.let { original ->
            val main = original.mainWorkout.takeIf { it.isNotBlank() }?.let { " — $it" }.orEmpty()
            Text(
                "Originally planned: ${original.focus}$main",
                style = type.caption.copy(fontStyle = FontStyle.Italic),
                color = colors.text,
            )
        }
        FlowRow(
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
            verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
            itemVerticalAlignment = Alignment.CenterVertically,
        ) {
            FitaiBadge(coachSourceLabel(entry.aiSource) ?: "Coach", tone = coachSourceTone(entry.aiSource))
            val chips = basedOnChips(inputs)
            if (chips.isNotEmpty()) {
                Text("Based on:", style = type.caption, color = colors.text)
                chips.forEach { FitaiBadge(it, tone = BadgeTone.Secondary) }
            }
        }
    }
}
