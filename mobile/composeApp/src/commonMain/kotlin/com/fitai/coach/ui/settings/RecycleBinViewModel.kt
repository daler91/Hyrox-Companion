package com.fitai.coach.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetRecycleBinResponse
import com.fitai.coach.core.api.generated.RecycleBinItem
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RecycleBinState(
    /** The bin as last fetched; null until it has been once. */
    val bin: GetRecycleBinResponse? = null,
    /** The bin couldn't be fetched and none is cached. */
    val loadFailed: Boolean = false,
    /** The athlete's today and timezone, which the "deleted" and "expires" copy count in. */
    val today: String = "",
    val timeZone: String? = null,
    /** The bin's sheet is open. */
    val open: Boolean = false,
    /** What is being saved: an item's id, or "empty". Everything else waits. */
    val busy: String? = null,
    val confirm: RecycleBinConfirm? = null,
) {
    val total: Long get() = bin?.counts?.total ?: 0
}

/**
 * Settings → Recycle bin (the web's RecycleBinCard): what was deleted in
 * the last 90 days, each restorable or deletable for good, and the whole bin
 * emptiable. Deleting forever and emptying ask first, as on the web.
 */
@Suppress("TooGenericExceptionCaught")
class RecycleBinViewModel(private val session: UserSession, private val todayIn: (String?) -> String) : ViewModel() {
    private val local = MutableStateFlow(RecycleBinState())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<RecycleBinState> = combine(local, session.recycleBin.bin, session.preferences.preferences) { s, bin, prefs ->
        s.copy(bin = bin, today = todayIn(prefs?.userTimezone), timeZone = prefs?.userTimezone)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, RecycleBinState())

    init {
        refresh()
    }

    /** Fetches the bin; offline, the cached copy stays, and with none the sheet offers to try again. */
    fun refresh() {
        local.update { it.copy(loadFailed = false) }
        viewModelScope.launch {
            try {
                session.recycleBin.refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                local.update { it.copy(loadFailed = true) }
            }
        }
    }

    /** Opens the bin, fetching it again: something may have been deleted since Settings opened. */
    fun open() {
        local.update { it.copy(open = true) }
        refresh()
    }

    fun close() = local.update { it.copy(open = false, confirm = null) }

    /** Puts the item back, then refreshes the timeline and plans it reappears on. */
    fun restore(item: RecycleBinItem) = run(item.id) {
        try {
            val result = session.recycleBin.restore(item)
            toasts.send(restoredMessage(result.warnings))
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toasts.send(restoreFailure(e))
            return@run
        }
        quietly { session.timeline.refresh() }
        quietly { session.timeline.refreshPlans() }
    }

    fun ask(step: RecycleBinConfirm) = local.update { it.copy(confirm = step) }

    fun dismissConfirm() = local.update { it.copy(confirm = null) }

    /** Does the final step the athlete just confirmed. */
    fun confirm() {
        val step = state.value.confirm ?: return
        dismissConfirm()
        when (step) {
            is RecycleBinConfirm.Purge -> run(step.item.id) {
                guarded("Couldn't delete that item") {
                    session.recycleBin.purge(step.item)
                    toasts.send("Deleted forever")
                }
            }
            RecycleBinConfirm.Empty -> run(EMPTY) {
                guarded("Couldn't empty the recycle bin") { toasts.send(emptiedMessage(session.recycleBin.empty())) }
            }
        }
    }

    /** One change at a time, as the web disables the other buttons while one runs. */
    private fun run(key: String, block: suspend () -> Unit) {
        if (local.value.busy != null) return
        local.update { it.copy(busy = key) }
        viewModelScope.launch {
            try {
                block()
            } finally {
                local.update { it.copy(busy = null) }
            }
        }
    }

    private suspend fun guarded(failure: String, block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            toasts.send(e.userMessage(failure))
        }
    }

    /** A refresh after a restore that already went through: failing, the screens catch up on their next one. */
    @Suppress("SwallowedException")
    private suspend fun quietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The restore was saved; the timeline refreshes again on its own.
        }
    }

    private companion object {
        const val EMPTY = "empty"
    }
}
