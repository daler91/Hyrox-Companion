package com.fitai.coach.ui.nutrition

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchResponse
import com.fitai.coach.core.api.generated.GetNutritionRecipesResponseItem
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionLogEntryWithNutrition
import com.fitai.coach.core.data.Meal
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
 * The athlete's own foods (MyFoodsSection.tsx, CustomFoodDialog.tsx,
 * RecipeBuilderDialog.tsx): the custom foods and recipes they've made, kept on
 * the device, and the sheets that make or edit them. Logging one goes through
 * search, like any food. [openDate] is the day on screen, which an edit
 * refreshes; [search] finds a recipe's ingredients.
 */
@Suppress("TooGenericExceptionCaught")
class MyFoodsViewModel(
    private val myFoods: MyFoods,
    search: suspend (String) -> GetNutritionFoodsSearchResponse,
    private val openDate: () -> String,
) : ViewModel() {
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val customFoods: StateFlow<List<NutritionFood>?> =
        myFoods.customFoods().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    val recipes: StateFlow<List<GetNutritionRecipesResponseItem>?> =
        myFoods.recipes().stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val _customFood = MutableStateFlow<CustomFoodSheetState?>(null)
    val customFood: StateFlow<CustomFoodSheetState?> = _customFood.asStateFlow()

    private val _recipe = MutableStateFlow<RecipeSheetState?>(null)
    val recipe: StateFlow<RecipeSheetState?> = _recipe.asStateFlow()

    private val searcher = FoodSearcher(viewModelScope, search) { toasts.send(it) }

    /** Foods found for a recipe's next ingredient. */
    val ingredientSearch: StateFlow<SearchState> = searcher.state

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

    fun newRecipe() {
        _recipe.value = RecipeSheetState()
    }

    /** Opens the builder on a saved recipe, once it has loaded. */
    fun editRecipe(item: GetNutritionRecipesResponseItem) {
        _recipe.value = RecipeSheetState(editingId = item.id, name = item.name, loading = true)
        viewModelScope.launch {
            try {
                val loaded = recipeSheet(myFoods.recipe(item.id))
                _recipe.update { open -> loaded.takeIf { open?.editingId == item.id } ?: open }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _recipe.update { open -> open?.takeIf { it.editingId != item.id } }
                toasts.send(e.userMessage("Couldn't open that recipe"))
            }
        }
    }

    /** Opens the builder on [meal]'s entries ("Save as recipe"). */
    fun saveMealAsRecipe(meal: Meal, entries: List<NutritionLogEntryWithNutrition>) {
        _recipe.value = recipeFromMeal(meal, entries)
    }

    fun editRecipeSheet(change: (RecipeSheetState) -> RecipeSheetState) = _recipe.update { it?.let(change) }

    fun searchIngredients(query: String) = searcher.searchFor(query)

    /** Adds a searched food at one serving (or 100 g), and clears the search for the next. */
    fun addIngredient(food: NutritionFood) {
        _recipe.update { it?.copy(ingredients = it.ingredients + ingredientFor(food)) }
        searcher.clear()
    }

    fun closeRecipe() {
        _recipe.value = null
        searcher.clear()
    }

    fun saveRecipe() {
        val sheet = _recipe.value?.takeIf { it.valid && !it.saving && !it.loading } ?: return
        _recipe.value = sheet.copy(saving = true)
        viewModelScope.launch {
            val editingId = sheet.editingId
            try {
                if (editingId == null) {
                    myFoods.createRecipe(sheet.draft())
                    toasts.send("Recipe saved")
                } else {
                    myFoods.updateRecipe(editingId, sheet.draft(), openDate())
                    toasts.send("Recipe updated")
                }
                closeRecipe()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                _recipe.value = sheet.copy(saving = false)
                toasts.send(e.userMessage(if (editingId == null) "Couldn't save that recipe" else "Couldn't update that recipe"))
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
