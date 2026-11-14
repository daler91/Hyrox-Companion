package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.MAX_BULK_DELETE

/** The key an entry is picked by (getBulkDeleteSelectionKey); null for one that can't be deleted. */
fun selectionKey(entry: TimelineEntry): String? = entry.planDayId?.let { "plan:$it" } ?: entry.workoutLogId?.let { "log:$it" }

/** Picking timeline entries to delete together (useBulkDeleteSelection); [deleting] while the delete is on its way. */
data class Selection(val keys: Set<String> = emptySet(), val deleting: Boolean = false) {
    val count: Int get() = keys.size

    /** More than one delete takes: the server refuses it whole. */
    val tooMany: Boolean get() = count > MAX_BULK_DELETE

    fun picks(entry: TimelineEntry): Boolean = selectionKey(entry) in keys
}

/** What the selection bar's buttons do. */
class SelectionActions(
    val onSelectAll: () -> Unit,
    val onClear: () -> Unit,
    val onDelete: () -> Unit,
    val onDone: () -> Unit,
)

/** The entries on screen that can be picked. */
fun selectable(rows: TimelineRows): List<TimelineEntry> = rows.days.flatMap { it.entries }.filter { selectionKey(it) != null }

/** The undo toast after a bulk delete. */
fun removedLabel(count: Int): String = if (count == 1) "Workout removed" else "$count workouts removed"

/**
 * The confirm's warning (BulkDeleteControls): a completed planned session
 * keeps its plan day, which reads planned again, or missed once its date has passed.
 */
fun deleteSelectedText(count: Int): String =
    "This will remove $count selected workout${if (count == 1) "" else "s"} from your timeline. " +
        "Completed planned sessions keep their plan days: only their logged workouts are removed, " +
        "and each day shows as planned again, or missed if its date has passed."
