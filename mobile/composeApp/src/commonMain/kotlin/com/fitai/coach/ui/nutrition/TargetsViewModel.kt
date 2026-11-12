package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.NutritionMealFuelTarget
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.data.Meal
import com.fitai.coach.core.data.TargetSettings
import com.fitai.coach.core.data.storedPeriodization
import com.fitai.coach.core.js.jsNumberToString
import com.fitai.coach.core.nutrition.PeriodizationChoice
import com.fitai.coach.core.nutrition.calculateNutritionTarget
import com.fitai.coach.core.nutrition.nextPeriodizationSettings
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * The athlete's nutrition targets (TargetsDialog.tsx, MealTargetDialog.tsx):
 * the daily goals, worked out from the profile or typed, with load scaling and
 * adaptive targets; and one meal's pins. Both apply from today; [openDate] is
 * the day on screen, which a save refreshes. [profile] reads the athlete's
 * profile for "Calculate from profile".
 */
@Suppress("TooGenericExceptionCaught")
class TargetsViewModel(
    private val targets: TargetSettings,
    private val profile: suspend () -> PreferencesResponse?,
    private val openDate: () -> String,
) : ViewModel() {
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private val _daily = MutableStateFlow<TargetsSheetState?>(null)
    val daily: StateFlow<TargetsSheetState?> = _daily.asStateFlow()

    private val _meal = MutableStateFlow<MealTargetSheetState?>(null)
    val meal: StateFlow<MealTargetSheetState?> = _meal.asStateFlow()

    /**
     * Opens the daily sheet once the saved version, the profile and the
     * typical load are in. The profile and load may be missing; the saved
     * version may not, since a save carries its calibration forward and would
     * otherwise switch load scaling off.
     */
    fun openDaily() {
        _daily.value = TargetsSheetState()
        viewModelScope.launch {
            val athlete = async { orNull { profile() } }
            val load = async { orNull { targets.typicalDailyLoad() } }
            val current = try {
                targets.current()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _daily.value = null
                toasts.send(e.userMessage("Couldn't load your targets"))
                return@launch
            }
            val sheet = targetsSheet(current, athlete.await(), load.await())
            _daily.update { open -> if (open?.loading == true) sheet else open }
        }
    }

    fun editDaily(change: (TargetsSheetState) -> TargetsSheetState) = _daily.update { it?.let(change) }

    fun editDailyFields(change: (MacroFields) -> MacroFields) = editDaily { it.copy(fields = change(it.fields)) }

    /** Fills the four goals from the profile, and says how (or warns of a floor). */
    fun calculateFromProfile() = editDaily { sheet ->
        val input = sheet.profile ?: return@editDaily sheet
        val result = calculateNutritionTarget(input)
        sheet.copy(
            fields = MacroFields(
                calories = jsNumberToString(result.calories),
                protein = jsNumberToString(result.proteinG),
                carb = jsNumberToString(result.carbG),
                fat = jsNumberToString(result.fatG),
            ),
            calcNote = result.warning ?: result.explanation,
        )
    }

    fun closeDaily() {
        _daily.value = null
    }

    /** Saves the goals as a new version, carrying the current calibration forward onto a changed carb goal. */
    fun saveDaily() {
        val sheet = _daily.value?.takeIf { !it.saving && !it.loading } ?: return
        val goals = sheet.fields.parsed() ?: return
        val periodization = nextPeriodizationSettings(
            sheet.current?.storedPeriodization(),
            PeriodizationChoice(goals.carbG, sheet.periodize, recoveryEnabled = sheet.adaptive, phaseAware = sheet.adaptive),
            sheet.typicalLoad,
        )
        _daily.value = sheet.copy(saving = true)
        viewModelScope.launch {
            try {
                targets.save(goals, periodization, openDate())
                _daily.value = null
                toasts.send("Targets saved")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _daily.value = sheet.copy(saving = false)
                toasts.send(e.userMessage("Couldn't save your targets"))
            }
        }
    }

    fun openMeal(meal: Meal, target: NutritionMealFuelTarget) {
        _meal.value = mealTargetSheet(meal, target)
    }

    fun editMealFields(change: (MacroFields) -> MacroFields) = _meal.update { it?.copy(fields = change(it.fields)) }

    fun closeMeal() {
        _meal.value = null
    }

    /** Pins the typed goals. Calories the three pinned macros set aren't pinned beside them. */
    fun saveMeal() {
        val sheet = _meal.value?.takeIf { !it.busy } ?: return
        val pins = sheet.pins() ?: return
        val sent = if (sheet.caloriesLocked) pins.copy(calories = null) else pins
        mealWrite(sheet, sheet.copy(saving = true), "Couldn't save that meal's target") {
            targets.setMealTarget(sheet.meal, sent, openDate())
        }
    }

    /** Drops the pins: the meal follows its suggested split again. */
    fun resetMeal() {
        val sheet = _meal.value?.takeIf { !it.busy && it.overridden } ?: return
        mealWrite(sheet, sheet.copy(resetting = true), "Couldn't reset that meal's target") {
            targets.clearMealTarget(sheet.meal, openDate())
        }
    }

    private fun mealWrite(sheet: MealTargetSheetState, pending: MealTargetSheetState, failure: String, write: suspend () -> Unit) {
        _meal.value = pending
        viewModelScope.launch {
            try {
                write()
                _meal.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _meal.value = sheet
                toasts.send(e.userMessage(failure))
            }
        }
    }

    @Suppress("SwallowedException")
    private suspend fun <T> orNull(block: suspend () -> T): T? = try {
        block()
    } catch (e: CancellationException) {
        throw e
    } catch (_: Exception) {
        null
    }
}
