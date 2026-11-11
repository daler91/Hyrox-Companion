package com.fitai.coach.ui.analytics

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsResponseValueItem
import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.data.AnalyticsRange
import com.fitai.coach.core.data.AnalyticsRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

/** The tabs, in the web's order; those that don't use the date range are each their own window. */
enum class AnalyticsTab(val label: String, val usesRange: Boolean = true) {
    Overview("Overview"),
    Breakdown("Breakdown"),
    Records("Records"),
    Progression("Progression"),
    Sessions("Session quality", usesRange = false),
    Insights("Coach insights", usesRange = false),
    Predictor("Race predictor", usesRange = false),
    Maf("MAF trend", usesRange = false),
    Fuelling("Fuelling"),
}

/** The tabs this athlete sees: the MAF trend only for MAF-style training (Analytics.tsx). */
fun analyticsTabs(trainingStyleId: String?): List<AnalyticsTab> =
    AnalyticsTab.entries.filter { it != AnalyticsTab.Maf || trainingStyleId == MAF_TRAINING_STYLE }

data class AnalyticsUiState(
    val tab: AnalyticsTab = AnalyticsTab.Overview,
    val range: AnalyticsRange = AnalyticsRange.Quarter,
    val overview: TrainingOverview? = null,
    val records: Map<String, PersonalRecord>? = null,
    val exercises: Map<String, List<GetExerciseAnalyticsResponseValueItem>>? = null,
    val block: GetNutritionBlockResponse? = null,
    val category: String = "All",
    val exercise: String? = null,
    val loading: Boolean = true,
    val failed: Boolean = false,
)

/** Analytics (/analytics): the range-driven tabs; the others load their own panels. */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooGenericExceptionCaught")
class AnalyticsViewModel(private val analytics: AnalyticsRepository, private val today: String) : ViewModel() {
    private val selection = MutableStateFlow(Selection())
    private val status = MutableStateFlow(Status())

    val state: StateFlow<AnalyticsUiState> = combine(
        selection,
        selection.flatMapLatest { s ->
            combine(
                analytics.overview(s.range),
                analytics.records(s.range),
                analytics.exercises(s.range),
                analytics.nutritionBlock(s.range),
            ) { o, r, e, b -> RangeData(o, r, e, b) }
        },
        status,
    ) { s, data, st ->
        val hasData = when (s.tab) {
            AnalyticsTab.Overview, AnalyticsTab.Breakdown -> data.overview != null
            AnalyticsTab.Records -> data.records != null
            AnalyticsTab.Progression -> data.records != null && data.exercises != null
            AnalyticsTab.Fuelling -> data.block != null
            // These panels load themselves.
            AnalyticsTab.Sessions, AnalyticsTab.Insights, AnalyticsTab.Predictor, AnalyticsTab.Maf -> true
        }
        AnalyticsUiState(
            tab = s.tab,
            range = s.range,
            overview = data.overview,
            records = data.records,
            exercises = data.exercises,
            block = data.block,
            category = s.category,
            exercise = s.exercise,
            loading = !hasData && st.loading,
            failed = !hasData && st.failed,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), AnalyticsUiState())

    init {
        refresh()
    }

    fun refresh() {
        val current = selection.value
        if (!current.tab.usesRange) return
        viewModelScope.launch {
            status.value = Status(loading = true)
            val ok = try {
                when (current.tab) {
                    AnalyticsTab.Overview, AnalyticsTab.Breakdown -> analytics.refreshOverview(current.range, today)
                    AnalyticsTab.Records -> analytics.refreshRecords(current.range, today)
                    AnalyticsTab.Progression -> {
                        analytics.refreshRecords(current.range, today)
                        analytics.refreshExercises(current.range, today)
                    }
                    AnalyticsTab.Fuelling -> analytics.refreshNutritionBlock(current.range, today)
                    AnalyticsTab.Sessions, AnalyticsTab.Insights, AnalyticsTab.Predictor, AnalyticsTab.Maf -> Unit
                }
                true
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                false
            }
            status.value = Status(loading = false, failed = !ok)
        }
    }

    fun selectTab(tab: AnalyticsTab) {
        selection.value = selection.value.copy(tab = tab)
        refresh()
    }

    fun selectRange(range: AnalyticsRange) {
        selection.value = selection.value.copy(range = range)
        refresh()
    }

    fun selectCategory(category: String) {
        selection.value = selection.value.copy(category = category)
    }

    fun selectExercise(key: String) {
        selection.value = selection.value.copy(exercise = key)
    }

    private data class Selection(
        val tab: AnalyticsTab = AnalyticsTab.Overview,
        val range: AnalyticsRange = AnalyticsRange.Quarter,
        val category: String = "All",
        val exercise: String? = null,
    )

    private data class Status(val loading: Boolean = false, val failed: Boolean = false)

    private data class RangeData(
        val overview: TrainingOverview?,
        val records: Map<String, PersonalRecord>?,
        val exercises: Map<String, List<GetExerciseAnalyticsResponseValueItem>>?,
        val block: GetNutritionBlockResponse?,
    )

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}
