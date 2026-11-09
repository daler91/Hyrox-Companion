package com.fitai.coach.ui.components

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import kotlinx.coroutines.CancellationException

/**
 * Shows [message] with an Undo action, as the web's undo toasts do after a
 * delete, and runs [undo] (a recycle-bin restore) when it is tapped.
 */
@Suppress("TooGenericExceptionCaught")
suspend fun offerUndo(toasts: SnackbarHostState, message: String, undo: suspend () -> Unit) {
    val result = toasts.showSnackbar(message, actionLabel = "Undo", withDismissAction = false, duration = SnackbarDuration.Long)
    if (result != SnackbarResult.ActionPerformed) return
    try {
        undo()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        toasts.showSnackbar("Couldn't undo that. It's in the recycle bin on the web.")
    }
}
