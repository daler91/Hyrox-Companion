package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SearchState(
    val query: String = "",
    val searching: Boolean = false,
    val results: List<NutritionFood> = emptyList(),
    val searched: Boolean = false,
    val degraded: Boolean = false,
)

/**
 * Food search as the athlete types (FoodSearch.tsx): 300 ms after they stop,
 * from 2 characters. A failed search clears the results and says so through
 * [onError].
 */
@Suppress("TooGenericExceptionCaught")
class FoodSearcher(
    private val scope: CoroutineScope,
    private val search: suspend (String) -> GetNutritionFoodsSearchResponse,
    private val onError: suspend (String) -> Unit,
) {
    private val _state = MutableStateFlow(SearchState())
    val state: StateFlow<SearchState> = _state.asStateFlow()
    private var job: Job? = null

    fun searchFor(query: String) {
        _state.update { it.copy(query = query) }
        job?.cancel()
        if (query.trim().length < MIN_QUERY) {
            _state.update { it.copy(results = emptyList(), searching = false, searched = false) }
            return
        }
        job = scope.launch {
            delay(DEBOUNCE_MS)
            _state.update { it.copy(searching = true) }
            try {
                val result = search(query)
                _state.update { it.copy(results = result.results, degraded = result.apiDegraded, searching = false, searched = true) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(searching = false, searched = true, results = emptyList()) }
                onError(e.userMessage("Couldn't search foods"))
            }
        }
    }

    fun clear() {
        job?.cancel()
        _state.value = SearchState()
    }

    private companion object {
        const val MIN_QUERY = 2
        const val DEBOUNCE_MS = 300L
    }
}
