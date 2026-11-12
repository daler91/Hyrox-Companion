package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetNutritionRecipesResponseItem
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.data.MyFoods
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

/**
 * The athlete's own foods (MyFoodsSection.tsx, CustomFoodDialog.tsx): the
 * custom foods and recipes they've made, kept on the device, and the sheet
 * that makes or edits a custom food. Logging one goes through search, like
 * any food. [openDate] is the day on screen, which an edit refreshes.
 */
@Suppress("TooGenericExceptionCaught")
class MyFoodsViewModel(private val myFoods: MyFoods, private val openDate: () -> String) : ViewModel() {
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val customFoods: StateFlow<List<NutritionFood>?> =
        myFoods.customFoods().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val recipes: StateFlow<List<GetNutritionRecipesResponseItem>?> =
        myFoods.recipes().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _customFood = MutableStateFlow<CustomFoodSheetState?>(null)
    val customFood: StateFlow<CustomFoodSheetState?> = _customFood.asStateFlow()

    init {
        refresh()
    }

    /** Reloads both lists; a failure keeps what's on the device. */
    fun refresh() {
        viewModelScope.launch {
            quietly { myFoods.refreshCustomFoods() }
            quietly { myFoods.refreshRecipes() }
        }
    }

    fun newCustomFood() {
        _customFood.value = CustomFoodSheetState()
    }

    fun editCustomFood(food: NutritionFood) {
        _customFood.value = customFoodSheet(food)
    }

    fun editCustomFoodSheet(change: (CustomFoodSheetState) -> CustomFoodSheetState) = _customFood.update { it?.let(change) }

    fun closeCustomFood() {
        _customFood.value = null
    }

    fun saveCustomFood() {
        val sheet = _customFood.value?.takeIf { it.valid && !it.saving } ?: return
        _customFood.value = sheet.copy(saving = true)
        viewModelScope.launch {
            val editing = sheet.editing
            try {
                if (editing == null) {
                    myFoods.createFood(sheet.draft(), sheet.completePortions())
                    toasts.send("Custom food saved")
                } else {
                    myFoods.updateFood(editing.id, sheet.draft(), sheet.isPublic, openDate())
                    toasts.send("Custom food updated")
                }
                _customFood.value = null
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _customFood.value = sheet.copy(saving = false)
                toasts.send(e.userMessage(if (editing == null) "Couldn't save that food" else "Couldn't update that food"))
            }
        }
    }

    fun deleteCustomFood(food: NutritionFood) {
        viewModelScope.launch {
            try {
                myFoods.deleteFood(food.id)
                toasts.send("Custom food deleted")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't delete that food"))
            }
        }
    }

    fun deleteRecipe(recipe: GetNutritionRecipesResponseItem) {
        viewModelScope.launch {
            try {
                myFoods.deleteRecipe(recipe.id)
                toasts.send("Recipe deleted")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't delete that recipe"))
            }
        }
    }

    @Suppress("SwallowedException")
    private suspend fun quietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The cached list stands until the next refresh.
        }
    }
}
