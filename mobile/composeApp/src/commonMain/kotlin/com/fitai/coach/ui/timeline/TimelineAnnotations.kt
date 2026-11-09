package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.data.AnnotationDraft
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiBottomSheet
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.components.FitaiDateField
import com.fitai.coach.ui.components.FitaiDialog
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/** The kinds of note the editor offers, in the web's order. */
val ANNOTATION_TYPES: List<TimelineAnnotation.Type> = listOf(
    TimelineAnnotation.Type.Injury,
    TimelineAnnotation.Type.Illness,
    TimelineAnnotation.Type.Travel,
    TimelineAnnotation.Type.Rest,
)

/** Why a note can't be saved yet, or null when it can. */
fun annotationProblem(draft: AnnotationDraft): String? = when {
    draft.startDate.isBlank() || draft.endDate.isBlank() -> "Pick a start and an end date."
    draft.endDate < draft.startDate -> "The end date can't be before the start date."
    else -> null
}

/** A note on the day it starts (TimelineAnnotationCard), with edit and delete. */
@Composable
fun AnnotationCard(annotation: TimelineAnnotation, onEdit: () -> Unit, onDelete: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val label = annotationLabel(annotation.type)
    var confirming by rememberSaveable { mutableStateOf(false) }
    FitaiCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                FitaiBadge(label, tone = annotationTone(annotation.type))
                Text(annotationRange(annotation), style = type.bodySm, color = colors.textMuted)
                annotation.note?.takeIf { it.isNotBlank() }?.let { Text(it, style = type.body, color = colors.text) }
            }
            IconButton(onClick = onEdit) { Icon(LucideIcons.Pencil, contentDescription = "Edit $label note", tint = colors.textMuted) }
            IconButton(onClick = { confirming = true }) {
                Icon(LucideIcons.Trash, contentDescription = "Delete $label note", tint = colors.textMuted)
            }
        }
    }
    if (confirming) {
        FitaiDialog(
            title = "Delete note?",
            text = "This $label note will be removed from your timeline.",
            confirmLabel = "Delete",
            onConfirm = {
                confirming = false
                onDelete()
            },
            onDismiss = { confirming = false },
            destructive = true,
        )
    }
}

/**
 * Adds a training note, or changes [editing] (AnnotationsDialog): what kind,
 * the days it covers, and an optional note.
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun AnnotationSheet(editing: TimelineAnnotation?, startDate: String, onSave: (AnnotationDraft) -> Unit, onDismiss: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    var kind by rememberSaveable { mutableStateOf(editing?.type?.takeIf { it in ANNOTATION_TYPES } ?: TimelineAnnotation.Type.Injury) }
    var start by rememberSaveable { mutableStateOf(editing?.startDate ?: startDate) }
    var end by rememberSaveable { mutableStateOf(editing?.endDate ?: startDate) }
    var note by rememberSaveable { mutableStateOf(editing?.note.orEmpty()) }
    val draft = AnnotationDraft(kind, start, end, note)
    val problem = annotationProblem(draft)
    FitaiBottomSheet(onDismissRequest = onDismiss) {
        Column(Modifier.padding(horizontal = Spacing.Lg), verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Text(
                if (editing == null) "Add a training note" else "Edit training note",
                style = type.h3,
                color = colors.text,
                modifier = Modifier.semantics { heading() },
            )
            Text(
                "Mark periods where injury, illness, travel, or rest affected your training so charts and future reviews have the context.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                ANNOTATION_TYPES.forEach { option ->
                    FitaiChip(annotationLabel(option), selected = kind == option, onClick = { kind = option })
                }
            }
            FitaiDateField(start, { picked ->
                start = picked
                if (end < picked) end = picked
            }, "Start")
            FitaiDateField(end, { end = it }, "End", minDate = start.ifBlank { null }, error = problem?.takeIf { end.isNotBlank() })
            FitaiTextField(note, { note = it }, "Note (optional)", placeholder = "Calf strain during sled push", singleLine = false)
            FitaiButton(
                if (editing == null) "Add note" else "Save changes",
                onClick = { onSave(draft) },
                enabled = problem == null,
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
