package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodServing
import com.fitai.coach.core.api.generated.NutritionFoodWithPortionMemory
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.NutritionRepository
import com.fitai.coach.core.data.isNothingToRepeat
import com.fitai.coach.core.data.isNutritionOff
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.ui.components.UndoOffer
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NutritionUiState(
    val date: String = "",
    val today: String = "",
    val summary: GetNutritionSummaryResponse? = null,
    val loading: Boolean = true,
    val loadFailed: Boolean = false,
    val featureOff: Boolean = false,
    /** A one-tap log is being sent: the one-tap buttons wait for it. */
    val quickLogging: Boolean = false,
    /** A day or meal is being repeated. */
    val repeating: Boolean = false,
)

/**
 * The log sheet: a new entry for [food], or an edit of [editing]. [servings]
 * are the food's named portions, shared and the athlete's own; [newPortion]
 * is the add-a-portion form while it's open.
 */
data class LogSheetState(
    val food: NutritionFood,
    val servings: List<NutritionFoodServing>,
    val unit: PortionUnit,
    val amount: String,
    val meal: Meal,
    val editing: NutritionLogEntryWithNutrition? = null,
    val saving: Boolean = false,
    val newPortion: PortionDraft? = null,
    val addingPortion: Boolean = false,
) {
    val units: List<PortionUnit> get() = portionUnits(food, servings)
    val quantityG: Double? get() = amount.trim().toDoubleOrNull()?.takeIf { it > 0 }?.let { it * unit.grams }
}

/** The food log for a day, as /nutrition does on the web (v1: log, search, targets). */
@OptIn(ExperimentalCoroutinesApi::class)
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class NutritionViewModel(
    private val nutrition: NutritionRepository,
    private val today: String,
    private val currentHour: () -> Int,
    private val loggedAt: (date: String) -> String,
) : ViewModel() {
    private val date = MutableStateFlow(today)
    private val status = MutableStateFlow(Status())
    private val busy = MutableStateFlow(Busy())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()
    private val undoOffers = Channel<UndoOffer>(Channel.BUFFERED)

    /** Done things the athlete can take back from their toast (a one-tap log's Undo). */
    val undos: Flow<UndoOffer> = undoOffers.receiveAsFlow()

    val state: StateFlow<NutritionUiState> = combine(date, date.flatMapLatest { nutrition.day(it) }, status, busy) { d, summary, s, b ->
        NutritionUiState(
            date = d,
            today = today,
            summary = summary,
            loading = summary == null && s.loading,
            loadFailed = summary == null && s.failed,
            featureOff = s.featureOff,
            quickLogging = b.quickLogging,
            repeating = b.repeating,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), NutritionUiState(date = today, today = today))

    /** The recent and favourite foods (QuickAddBar.tsx), kept on the device. */
    val quickAdd: StateFlow<QuickAddState> = combine(nutrition.shortcuts.recentFoods(), nutrition.shortcuts.favorites(), ::QuickAddState)
        .stateIn(viewModelScope, SharingStarted.Eagerly, QuickAddState())

    // A star flips as soon as it's tapped and settles when the write answers
    // (FavoriteStarButton.tsx): food id → the state asked for.
    private val starring = MutableStateFlow<Map<String, Boolean>>(emptyMap())

    /** Which foods are starred, with any taps still in flight already applied. */
    val favoriteIds: StateFlow<Set<String>> = combine(nutrition.shortcuts.favorites(), starring) { favorites, pending ->
        favorites.orEmpty().map { it.id }.toSet() - pending.filterValues { !it }.keys + pending.filterValues { it }.keys
    }.stateIn(viewModelScope, SharingStarted.Eagerly, emptySet())

    private val searcher = FoodSearcher(viewModelScope, nutrition::search) { toasts.send(it) }
    val search: StateFlow<SearchState> = searcher.state

    private val _logSheet = MutableStateFlow<LogSheetState?>(null)
    val logSheet: StateFlow<LogSheetState?> = _logSheet.asStateFlow()

    /** The meal new entries go to until the athlete picks another. */
    var preferredMeal: Meal? = null

    init {
        refresh()
    }

    /** Reloads the day and the recent and favourite foods. */
    fun refresh() {
        loadDay()
        loadQuickAdd()
    }

    private fun loadQuickAdd() {
        viewModelScope.launch {
            // Shortcuts: a failed load keeps what's on the device.
            ignoringFailure { nutrition.shortcuts.refreshRecentFoods() }
            ignoringFailure { nutrition.shortcuts.refreshFavorites() }
        }
    }

    private fun loadDay() {
        val day = date.value
        viewModelScope.launch {
            status.value = Status(loading = true)
            status.value = try {
                nutrition.refreshDay(day)
                Status()
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                Status(failed = true, featureOff = e.isNutritionOff())
            } catch (_: Exception) {
                Status(failed = true)
            }
        }
    }

    fun previousDay() = moveTo(addDaysToIsoDate(date.value, -1))

    fun nextDay() = moveTo(addDaysToIsoDate(date.value, 1))

    fun goToToday() = moveTo(today)

    /** Opens [day] (a link to a nutrition day). */
    fun goTo(day: String) = moveTo(day)

    private fun moveTo(day: String) {
        date.value = day
        loadDay()
    }

    /** Searches as the athlete types (FoodSearch.tsx). */
    fun searchFor(query: String) = searcher.searchFor(query)

    fun clearSearch() = searcher.clear()

    /**
     * Opens the log sheet for a new entry of [food]. A food logged before opens
     * on the grams and meal it was last logged in (Nutrition.tsx
     * openCreateDialog); [meal], the section it was added from, wins.
     */
    fun startLog(food: NutritionFood, meal: Meal? = null) {
        val remembered = quickAdd.value.portions[food.id]
        viewModelScope.launch {
            val servings = runCatching { nutrition.food(food.id).servings }.getOrDefault(emptyList())
            val units = portionUnits(food, servings)
            val (unit, amount) = remembered?.let { units.first() to it.quantityG } ?: defaultPortion(units)
            _logSheet.value = LogSheetState(
                food = food,
                servings = servings,
                unit = unit,
                amount = trim(amount),
                meal = meal ?: remembered?.meal ?: preferredMeal ?: mealForHour(currentHour()),
            )
        }
    }

    /** A favourite's chip: logged at once in its usual portion, or the log sheet when it hasn't one (QuickAddBar.tsx). */
    fun quickAddFavorite(food: NutritionFoodWithPortionMemory) {
        val item = food.quickLogItem() ?: return startLog(food.toFood())
        quickLog(item, date.value)
    }

    /** A recent food's chip opens the log sheet: the list is long and automatic, so a stray tap shouldn't log. */
    fun quickAddRecent(food: NutritionFoodWithPortionMemory) = startLog(food.toFood())

    /** Logs [entry]'s food, amount and meal again today: "I just ate this again", whichever day is open. */
    fun logAgain(entry: NutritionLogEntryWithNutrition) = quickLog(entry.quickLogItem(), today)

    // One tap, no sheet: the portion is known, so the undo covers a mis-tap (useQuickLog.tsx).
    private fun quickLog(item: QuickLogItem, day: String) {
        if (busy.value.quickLogging) return
        busy.update { it.copy(quickLogging = true) }
        viewModelScope.launch {
            try {
                val id = nutrition.log(item.foodId, item.quantityG, item.meal, loggedAt(day), day)
                undoOffers.send(UndoOffer(quickLoggedMessage(item), failure = "Couldn't undo that") { nutrition.deleteEntry(id, day) })
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't log ${item.name}"))
            } finally {
                busy.update { it.copy(quickLogging = false) }
            }
        }
    }

    /** Stars or un-stars a food for the quick-add row. */
    fun toggleFavorite(foodId: String) {
        val favorite = foodId !in favoriteIds.value
        starring.update { it + (foodId to favorite) }
        viewModelScope.launch {
            try {
                nutrition.shortcuts.setFavorite(foodId, favorite)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't update your favourites"))
            } finally {
                // The list now has the answer; on a failure that's the rollback.
                starring.update { it - foodId }
            }
        }
    }

    /** Copies the day before onto the open day: all of it, or only [meal] ("Copy yesterday's"). */
    fun repeatPreviousDay(meal: Meal? = null) {
        if (busy.value.repeating) return
        val day = date.value
        busy.update { it.copy(repeating = true) }
        viewModelScope.launch {
            try {
                toasts.send(repeatedMessage(nutrition.repeat(addDaysToIsoDate(day, -1), day, meal)))
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                toasts.send(
                    when {
                        !e.isNothingToRepeat() -> e.userMessage("Couldn't repeat that day")
                        meal == null -> "Nothing was logged the day before."
                        else -> "Nothing was logged for ${meal.label.lowercase()} the day before."
                    },
                )
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't repeat that day"))
            } finally {
                busy.update { it.copy(repeating = false) }
            }
        }
    }

    /** Opens the log sheet on an existing entry, its amount in grams. */
    fun startEdit(entry: NutritionLogEntryWithNutrition) {
        viewModelScope.launch {
            try {
                val detail = nutrition.food(entry.foodId)
                _logSheet.value = LogSheetState(
                    food = detail.food,
                    servings = detail.servings,
                    unit = portionUnits(detail.food, detail.servings).first(),
                    amount = trim(entry.quantityG),
                    meal = Meal.entries.firstOrNull { it.wireValue == entry.mealType.wireValue } ?: Meal.Snack,
                    editing = entry,
                )
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't open that entry"))
            }
        }
    }

    fun editLog(change: (LogSheetState) -> LogSheetState) = _logSheet.update { it?.let(change) }

    /** Opens, edits or closes the log sheet's add-a-portion form (null closes it). */
    fun editNewPortion(change: (PortionDraft?) -> PortionDraft?) = editLog { it.copy(newPortion = change(it.newPortion)) }

    /**
     * Saves the new portion as one of the athlete's own, then logs one of it
     * (LogFoodDialog.tsx handlePortionAdded).
     */
    fun saveNewPortion() {
        val sheet = _logSheet.value?.takeIf { !it.addingPortion } ?: return
        val portion = sheet.newPortion?.portion() ?: return
        _logSheet.value = sheet.copy(addingPortion = true)
        viewModelScope.launch {
            try {
                val serving = nutrition.myFoods.addPortion(sheet.food.id, portion)
                _logSheet.update { current ->
                    current?.takeIf { it.food.id == sheet.food.id }?.let { open ->
                        val servings = open.servings.filterNot { it.id == serving.id } + serving
                        open.copy(
                            servings = servings,
                            unit = portionUnits(open.food, servings).first { it.serving?.id == serving.id },
                            amount = "1",
                            newPortion = null,
                            addingPortion = false,
                        )
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _logSheet.update { it?.copy(addingPortion = false) }
                toasts.send(e.userMessage("Couldn't add that portion"))
            }
        }
    }

    /**
     * Removes one of the athlete's own portions. When it's the one picked, the
     * amount carries over in grams rather than reading the count as grams.
     */
    fun removePortion(unit: PortionUnit) {
        val sheet = _logSheet.value ?: return
        val serving = unit.serving?.takeIf { unit.own } ?: return
        val picked = sheet.unit == unit
        _logSheet.value = sheet.copy(
            servings = sheet.servings - serving,
            unit = if (picked) sheet.units.first() else sheet.unit,
            amount = if (picked) sheet.quantityG?.let { trim(kotlin.math.round(it)) } ?: sheet.amount else sheet.amount,
        )
        viewModelScope.launch {
            try {
                nutrition.myFoods.removePortion(sheet.food.id, serving.id)
                toasts.send("Portion removed")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _logSheet.update { current ->
                    current?.takeIf { it.food.id == sheet.food.id }?.let {
                        it.copy(
                            servings =
                            it.servings + serving,
                        )
                    }
                }
                toasts.send(e.userMessage("Couldn't remove that portion"))
            }
        }
    }

    fun closeLog() {
        _logSheet.value = null
    }

    fun submitLog() {
        val sheet = _logSheet.value ?: return
        val grams = sheet.quantityG ?: return
        _logSheet.value = sheet.copy(saving = true)
        viewModelScope.launch {
            val day = date.value
            try {
                val editing = sheet.editing
                if (editing == null) {
                    nutrition.log(sheet.food.id, grams, sheet.meal, loggedAt(day), day)
                    toasts.send("Logged ${sheet.food.name}")
                } else {
                    val changed = kotlin.math.abs(grams - editing.quantityG) > GRAM_EPSILON
                    nutrition.updateEntry(editing.id, sheet.meal, if (changed) grams else null, day)
                    toasts.send("Entry updated")
                }
                _logSheet.value = null
                clearSearch()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _logSheet.value = sheet.copy(saving = false)
                toasts.send(e.userMessage(if (sheet.editing == null) "Couldn't log that food" else "Couldn't update that entry"))
            }
        }
    }

    fun delete(entry: NutritionLogEntryWithNutrition) {
        viewModelScope.launch {
            try {
                nutrition.deleteEntry(entry.id, date.value)
                toasts.send("Entry deleted")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't delete that entry"))
            }
        }
    }

    private data class Status(val loading: Boolean = false, val failed: Boolean = false, val featureOff: Boolean = false)

    private data class Busy(val quickLogging: Boolean = false, val repeating: Boolean = false)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
        const val GRAM_EPSILON = 0.001
    }
}

private fun trim(value: Double): String = if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()

@Suppress("TooGenericExceptionCaught", "SwallowedException")
private suspend fun ignoringFailure(block: suspend () -> Unit) {
    try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        // The caller carries on without it.
    }
}
