package com.fitai.coach.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import kotlinx.coroutines.CancellationException

/** What a view model offers to undo: [message] with an Undo action, and what to say when [undo] fails. */
class UndoOffer(val message: String, val failure: String = RESTORE_FAILED, val undo: suspend () -> Unit)

private const val RESTORE_FAILED = "Couldn't undo that. It's in the recycle bin on the web."

/**
 * Shows [message] with an Undo action, as the web's undo toasts do after a
 * delete, and runs [undo] (a recycle-bin restore) when it is tapped.
 */
suspend fun offerUndo(
    toasts: SnackbarHostState,
    message: String,
    undo: suspend () -> Unit,
) = offerUndo(toasts, UndoOffer(message, undo = undo))

/** Shows [offer]'s message with an Undo action, and runs its undo when it is tapped. */
@Suppress("TooGenericExceptionCaught")
suspend fun offerUndo(toasts: SnackbarHostState, offer: UndoOffer) {
    val result = toasts.showSnackbar(offer.message, actionLabel = "Undo", withDismissAction = false, duration = SnackbarDuration.Long)
    if (result != SnackbarResult.ActionPerformed) return
    try {
        offer.undo()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        toasts.showSnackbar(offer.failure)
    }
}
