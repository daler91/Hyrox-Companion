package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionParseMealResponse
import com.fitai.coach.core.data.EncodedImage
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.MealEntryMethod
import com.fitai.coach.core.data.NutritionRepository
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** The describe sheet: the text as typed, and a parse that found nothing (the text stays to add detail to). */
data class DescribeState(val text: String = "", val reading: Boolean = false, val noFoodsFound: Boolean = false)

data class MealCaptureState(
    /** The describe sheet, open when set. */
    val describe: DescribeState? = null,
    /** A photo is with the AI (5–15 s). */
    val readingPhoto: Boolean = false,
    /** The parsed meal under review, open when set. */
    val review: MealReview? = null,
    /** The AI consent dialog, before the first AI parse. */
    val consentOpen: Boolean = false,
)

/**
 * Logging a meal with the AI (FR-4.1): describe it or photograph it, review
 * the suggested foods, then log them in one batch. Nothing is logged until
 * the athlete confirms. AI parsing needs consent: without it the consent
 * dialog opens, and accepting turns the AI Coach on and carries on with the
 * description or photo the athlete already gave (useAiConsentGate).
 */
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class MealCaptureViewModel(
    private val nutrition: NutritionRepository,
    aiEnabled: Flow<Boolean?>,
    private val enableAi: suspend () -> Unit,
    private val currentHour: () -> Int,
    private val loggedAt: (date: String) -> String,
) : ViewModel() {
    private val _state = MutableStateFlow(MealCaptureState())
    val state: StateFlow<MealCaptureState> = _state.asStateFlow()

    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    /** Finding a food for a review row: a swap, or a match for an item the parser couldn't place. */
    private val searcher = FoodSearcher(viewModelScope, nutrition::search) { toasts.send(it) }
    val search: StateFlow<SearchState> = searcher.state

    private val ai = aiEnabled.stateIn(viewModelScope, SharingStarted.Eagerly, null)
    private var pending: (() -> Unit)? = null

    // --- Describe ---

    fun openDescribe() = _state.update { it.copy(describe = DescribeState()) }

    fun editDescription(text: String) = _state.update { s ->
        s.copy(describe = s.describe?.copy(text = text.take(MAX_MEAL_DESCRIPTION), noFoodsFound = false))
    }

    fun closeDescribe() {
        if (_state.value.describe?.reading != true) _state.update { it.copy(describe = null) }
    }

    fun parseDescription() {
        val text = _state.value.describe?.text?.trim().orEmpty()
        if (text.isEmpty()) return
        requireAi { describe(text) }
    }

    private fun describe(text: String) {
        _state.update { it.copy(describe = it.describe?.copy(reading = true, noFoodsFound = false)) }
        viewModelScope.launch {
            try {
                val result = nutrition.parseMealText(text)
                if (result.items.isEmpty()) {
                    // A retry, not a result: the sheet and the text stay, for more detail.
                    _state.update { it.copy(describe = it.describe?.copy(reading = false, noFoodsFound = true)) }
                } else {
                    _state.update { it.copy(describe = null, review = review(result, MealEntryMethod.Described)) }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(describe = it.describe?.copy(reading = false)) }
                toasts.send(e.userMessage("Couldn't read that meal"))
            }
        }
    }

    // --- Snap ---

    /** Reads a meal photo; the review opens when it's done, even if the sheet that started it has closed. */
    fun parsePhoto(image: EncodedImage) = requireAi { snap(image) }

    private fun snap(image: EncodedImage) {
        if (_state.value.readingPhoto) return
        _state.update { it.copy(readingPhoto = true) }
        viewModelScope.launch {
            try {
                val result = nutrition.parseMealPhoto(image)
                _state.update { it.copy(readingPhoto = false, review = review(result, MealEntryMethod.Photo)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { it.copy(readingPhoto = false) }
                toasts.send(e.userMessage("Couldn't read that photo"))
            }
        }
    }

    private fun review(result: NutritionParseMealResponse, method: MealEntryMethod) =
        MealReview(method, result.rawInput, result.warnings, reviewRows(result, mealForHour(currentHour())))

    // --- AI consent ---

    private fun requireAi(action: () -> Unit) {
        if (ai.value == true) {
            action()
        } else {
            pending = action
            _state.update { it.copy(consentOpen = true) }
        }
    }

    /** Turns the AI Coach on, then carries on with what the athlete asked for. */
    fun acceptAi() {
        val action = pending
        pending = null
        _state.update { it.copy(consentOpen = false) }
        viewModelScope.launch {
            try {
                enableAi()
                action?.invoke()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                toasts.send("Could not enable AI features. Please try again.")
            }
        }
    }

    fun declineAi() {
        pending = null
        _state.update { it.copy(consentOpen = false) }
    }

    // --- Review ---

    private fun editRows(change: (List<ReviewRow>) -> List<ReviewRow>) =
        _state.update { s -> s.copy(review = s.review?.let { it.copy(rows = change(it.rows)) }) }

    private fun editRow(index: Int, change: (ReviewRow) -> ReviewRow) =
        editRows { rows -> rows.mapIndexed { i, row -> if (i == index) change(row) else row } }

    fun editGrams(index: Int, grams: String) = editRow(index) { it.copy(grams = grams.filter { c -> c.isDigit() || c == '.' }) }

    fun setMeal(index: Int, meal: Meal) = editRow(index) { it.copy(meal = meal) }

    fun removeRow(index: Int) {
        editRows { rows -> rows.filterIndexed { i, _ -> i != index } }
        _state.update { s -> s.copy(review = s.review?.copy(swapping = null)) }
        searcher.clear()
    }

    /** Opens the food search on [index]'s row (null closes it). */
    fun swapRow(index: Int?) {
        searcher.clear()
        _state.update { s -> s.copy(review = s.review?.copy(swapping = index)) }
    }

    fun searchFor(query: String) = searcher.searchFor(query)

    fun pickFood(food: NutritionFood) {
        val index = _state.value.review?.swapping ?: return
        editRow(index) { it.copy(food = food) }
        swapRow(null)
    }

    fun closeReview() {
        if (_state.value.review?.logging != true) {
            _state.update { it.copy(review = null) }
            searcher.clear()
        }
    }

    /** Logs the rows that have a match, in one batch, to [date]. */
    fun logReview(date: String) {
        val review = _state.value.review ?: return
        val items = review.items()
        if (items.isEmpty() || review.logging) return
        _state.update { it.copy(review = review.copy(logging = true)) }
        viewModelScope.launch {
            try {
                val created = nutrition.logMeal(review.method, review.rawInput, loggedAt(date), items, date)
                _state.update { it.copy(review = null) }
                toasts.send(loggedItemsToast(created))
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _state.update { s -> s.copy(review = s.review?.copy(logging = false)) }
                toasts.send(e.userMessage("Couldn't log those items"))
            }
        }
    }
}
