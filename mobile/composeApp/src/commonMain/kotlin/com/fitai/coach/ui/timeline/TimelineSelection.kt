package com.fitai.coach.ui.timeline

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Checkbox
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.MAX_BULK_DELETE
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

/**
 * The bar over the timeline while picking workouts to delete
 * (BulkDeleteToolbar): how many are picked, and the delete.
 */
@Composable
fun SelectionBar(selection: Selection, selectableCount: Int, actions: SelectionActions) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val idle = !selection.deleting
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text(
                "${selection.count} selected",
                style = type.label,
                color = colors.text,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            Text(
                if (selection.tooMany) {
                    "Select no more than $MAX_BULK_DELETE workouts at once"
                } else {
                    "$selectableCount visible workout${if (selectableCount == 1) "" else "s"} can be removed"
                },
                style = type.bodySm,
                color = if (selection.tooMany) colors.danger else colors.textMuted,
            )
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "Select all",
                    onClick = actions.onSelectAll,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled = idle && selection.count < selectableCount,
                )
                FitaiButton(
                    "Clear",
                    onClick = actions.onClear,
                    variant = ButtonVariant.Ghost,
                    size = ButtonSize.Sm,
                    enabled =
                    idle && selection.count > 0,
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
                FitaiButton(
                    "Delete selected",
                    onClick = actions.onDelete,
                    variant = ButtonVariant.Danger,
                    size = ButtonSize.Sm,
                    enabled = idle && selection.count > 0 && !selection.tooMany,
                    loading = selection.deleting,
                    leadingIcon = LucideIcons.Trash,
                )
                FitaiButton("Done", onClick = actions.onDone, variant = ButtonVariant.Secondary, size = ButtonSize.Sm, enabled = idle)
            }
        }
    }
}

/**
 * A card while picking: a tap picks or drops it instead of opening it, and its
 * own quick actions are off. One that can't be deleted shows without a box.
 */
@Composable
fun SelectableTimelineCard(entry: TimelineEntry, picked: Boolean, enabled: Boolean, onToggle: () -> Unit) {
    val selectable = selectionKey(entry) != null
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (selectable) {
            Checkbox(
                checked = picked,
                onCheckedChange = { onToggle() },
                enabled = enabled,
                modifier = Modifier.semantics { contentDescription = "Select ${entry.focus}" },
            )
        }
        Box(Modifier.weight(1f)) {
            TimelineCard(
                entry = entry,
                quickComplete = false,
                onOpen = { if (selectable && enabled) onToggle() },
                actions = CardActions(onComplete = {}, onUndoRecovery = {}, moves = emptyList(), onMove = {}, onPickDate = null),
            )
        }
    }
}
