package com.fitai.coach.ui.review

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.WeeklyReview
import com.fitai.coach.core.data.ReviewRepository
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WeeklyReviewUiState(
    /** The week asked for: any date inside it. */
    val week: String,
    val review: WeeklyReview? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
    val savingIntent: Boolean = false,
    /** The week shown is the running one: there's no later week to page to. */
    val atCurrentWeek: Boolean = false,
)

/**
 * One week's review, paged a week at a time. Paging steps from the week the
 * server resolved (in the athlete's timezone), not the one asked for, so a
 * timezone difference can't skip or repeat a week (Review.tsx).
 */
@Suppress("TooGenericExceptionCaught")
class WeeklyReviewViewModel(private val reviews: ReviewRepository, week: String?, private val today: String) : ViewModel() {
    private val _state = MutableStateFlow(WeeklyReviewUiState(week ?: lastCompletedWeekStart(today)))
    val state: StateFlow<WeeklyReviewUiState> = _state.asStateFlow()

    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private var loadJob: Job? = null

    init {
        load(_state.value.week)
    }

    fun retry() = load(_state.value.week)

    fun previousWeek() = load(addDaysToIsoDate(anchor(), -DAYS_IN_WEEK))

    fun nextWeek() {
        if (!_state.value.atCurrentWeek) load(addDaysToIsoDate(anchor(), DAYS_IN_WEEK))
    }

    /** Saves [text] as the line for next week; an emptied box clears a saved one. */
    fun saveIntent(text: String) {
        val review = _state.value.review ?: return
        val intent = text.trim().ifEmpty { null }
        _state.update { it.copy(savingIntent = true) }
        viewModelScope.launch {
            try {
                val saved = reviews.setIntent(review.weekStart, intent)
                _state.update { current ->
                    current.copy(
                        review =
                        current.review?.takeIf { it.weekStart == review.weekStart }?.copy(intent = saved) ?: current.review,
                    )
                }
                toasts.send(if (saved == null) "Cleared" else "Saved")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't save that"))
            } finally {
                _state.update { it.copy(savingIntent = false) }
            }
        }
    }

    /** The Monday to page from: the server's, once there is one. */
    private fun anchor(): String = _state.value.review?.weekStart ?: mondayOf(_state.value.week)

    private fun load(week: String) {
        loadJob?.cancel()
        _state.update {
            it.copy(week = week, loading = true, failed = false, atCurrentWeek = mondayOf(week) > lastCompletedWeekStart(today))
        }
        loadJob = viewModelScope.launch {
            try {
                val review = reviews.review(week)
                _state.update { it.copy(review = review, loading = false, atCurrentWeek = review.isCurrentWeek) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                // A week that won't load shows as an error with a retry, not as the previous week.
                _state.update { it.copy(review = null, loading = false, failed = true) }
            }
        }
    }

    private companion object {
        const val DAYS_IN_WEEK = 7
    }
}
