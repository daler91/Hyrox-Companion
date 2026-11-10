package com.fitai.coach.ui.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.RacePrediction
import com.fitai.coach.core.data.AnalyticsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

data class RacePredictorState(
    val prediction: RacePrediction? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
    val regenerating: Boolean = false,
)

/**
 * The predicted HYROX finish (useRacePrediction): the stored prediction
 * paints at once from the device and is fetched without spending AI;
 * Regenerate asks for a fresh one, which may.
 */
@Suppress("TooGenericExceptionCaught")
class RacePredictorViewModel(private val analytics: AnalyticsRepository) : ViewModel() {
    private val status = MutableStateFlow(Status(loading = true))
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<RacePredictorState> = combine(analytics.racePrediction, status) { prediction, st ->
        RacePredictorState(
            prediction,
            loading = prediction == null && st.loading,
            failed = prediction == null && st.failed,
            regenerating = st.working,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), RacePredictorState())

    init {
        load(regenerate = false)
    }

    fun retry() = load(regenerate = false)

    fun regenerate() = load(regenerate = true)

    private fun load(regenerate: Boolean) {
        if (status.value.working) return
        status.value = Status(loading = !regenerate, working = regenerate)
        viewModelScope.launch {
            val ok = try {
                analytics.refreshRacePrediction(regenerate)
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                false
            }
            status.value = Status(failed = !ok)
            if (!ok && state.value.prediction != null) toasts.send("Couldn't update your race prediction")
        }
    }

    private data class Status(val loading: Boolean = false, val failed: Boolean = false, val working: Boolean = false)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
