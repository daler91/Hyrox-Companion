package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetNutritionRecipesResponseItem
import com.fitai.coach.core.api.generated.NutritionFood
import com.fitai.coach.core.api.generated.NutritionFoodServing
import com.fitai.coach.core.api.generated.NutritionRecipe
import com.fitai.coach.core.api.generated.PatchNutritionFoodsByIdRequest
import com.fitai.coach.core.api.generated.PatchNutritionRecipesByIdRequest
import com.fitai.coach.core.api.generated.PostNutritionFoodsByIdServingsRequest
import com.fitai.coach.core.api.generated.PostNutritionFoodsRequest
import com.fitai.coach.core.api.generated.PostNutritionRecipesRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer

/** A custom food as the athlete types it: nutrition per 100 g; a null figure is unknown. */
public data class CustomFoodDraft(
    val name: String,
    val brand: String?,
    val caloriesPer100g: Double?,
    val proteinPer100g: Double?,
    val carbPer100g: Double?,
    val fatPer100g: Double?,
    val fiberPer100g: Double?,
    val servingSizeG: Double?,
)

/** A named portion of a food: "1 slice", 35 g. */
public data class Portion(val label: String, val grams: Double)

/** A recipe as the athlete builds it: what goes in, in grams, and how many servings it makes. */
public data class RecipeDraft(val name: String, val servings: Double, val ingredients: List<Ingredient>) {
    public data class Ingredient(val foodId: String, val quantityG: Double)
}

/**
 * The athlete's own foods: custom foods, named portions and recipes. The lists
 * are kept on the device. A changed food or recipe changes the entries that
 * log it, on any day, so [foodChanged] refreshes the days.
 */
public class MyFoods internal constructor(
    private val api: ApiClient,
    private val cache: CacheStore,
    private val foodChanged: suspend (date: String) -> Unit,
) {
    /** The athlete's custom foods by name, without recipes' backing foods. */
    public fun customFoods(): Flow<List<NutritionFood>?> = cache.observe(CUSTOM_KEY, FOODS)

    public fun recipes(): Flow<List<GetNutritionRecipesResponseItem>?> = cache.observe(RECIPES_KEY, RECIPES)

    public suspend fun refreshCustomFoods() {
        cache.put(CUSTOM_KEY, FOODS, api.call(ApiEndpoints.GetNutritionFoodsCustom))
    }

    public suspend fun refreshRecipes() {
        cache.put(RECIPES_KEY, RECIPES, api.call(ApiEndpoints.GetNutritionRecipes))
    }

    /** Creates a private custom food with its named [portions]; returns it. */
    public suspend fun createFood(draft: CustomFoodDraft, portions: List<Portion>): NutritionFood {
        val request = PostNutritionFoodsRequest(
            name = draft.name,
            brand = Patch.of(draft.brand),
            caloriesPer100g = Patch.of(draft.caloriesPer100g),
            proteinPer100g = Patch.of(draft.proteinPer100g),
            carbPer100g = Patch.of(draft.carbPer100g),
            fatPer100g = Patch.of(draft.fatPer100g),
            fiberPer100g = Patch.of(draft.fiberPer100g),
            servingSizeG = Patch.of(draft.servingSizeG),
            servings = portions.map { PostNutritionFoodsRequest.ServingsItem(it.label, it.grams) }.ifEmpty { null },
        )
        val food = api.call(ApiEndpoints.PostNutritionFoods, request)
        refreshCustomFoods()
        return food
    }

    /** Saves an edit of one of the athlete's custom foods; [isPublic] shares it with everyone. Refreshes [date]. */
    public suspend fun updateFood(id: String, draft: CustomFoodDraft, isPublic: Boolean, date: String) {
        val request = PatchNutritionFoodsByIdRequest(
            name = draft.name,
            brand = Patch.of(draft.brand),
            caloriesPer100g = Patch.of(draft.caloriesPer100g),
            proteinPer100g = Patch.of(draft.proteinPer100g),
            carbPer100g = Patch.of(draft.carbPer100g),
            fatPer100g = Patch.of(draft.fatPer100g),
            fiberPer100g = Patch.of(draft.fiberPer100g),
            servingSizeG = Patch.of(draft.servingSizeG),
            isPublic = isPublic,
        )
        api.call(ApiEndpoints.PatchNutritionFoodsById, request, path = ApiEndpoints.PatchNutritionFoodsById.path(id))
        refreshCustomFoods()
        foodChanged(date)
    }

    public suspend fun deleteFood(id: String) {
        api.call(ApiEndpoints.DeleteNutritionFoodsById, path = ApiEndpoints.DeleteNutritionFoodsById.path(id))
        refreshCustomFoods()
    }

    /** Adds a personal named portion to any food the athlete can see; a label it already has returns that one. */
    public suspend fun addPortion(foodId: String, portion: Portion): NutritionFoodServing = api.call(
        ApiEndpoints.PostNutritionFoodsByIdServings,
        PostNutritionFoodsByIdServingsRequest(label = portion.label, grams = portion.grams),
        path = ApiEndpoints.PostNutritionFoodsByIdServings.path(foodId),
    )

    /** Removes one of the athlete's own portions (shared ones can't be). */
    public suspend fun removePortion(foodId: String, servingId: String) {
        api.call(
            ApiEndpoints.DeleteNutritionFoodsByIdServingsByServingId,
            path = ApiEndpoints.DeleteNutritionFoodsByIdServingsByServingId.path(foodId, servingId),
        )
    }

    public suspend fun recipe(id: String): NutritionRecipe =
        api.call(ApiEndpoints.GetNutritionRecipesById, path = ApiEndpoints.GetNutritionRecipesById.path(id))

    /** Creates a recipe and the food it's logged as (by its `foodId`). */
    public suspend fun createRecipe(draft: RecipeDraft): NutritionRecipe {
        val request = PostNutritionRecipesRequest(
            name = draft.name,
            servings = draft.servings,
            ingredients = draft.ingredients.map { PostNutritionRecipesRequest.IngredientsItem(it.foodId, it.quantityG) },
        )
        val recipe = api.call(ApiEndpoints.PostNutritionRecipes, request)
        refreshRecipes()
        return recipe
    }

    /** Replaces a recipe's name, servings and ingredients; its logged entries follow. Refreshes [date]. */
    public suspend fun updateRecipe(id: String, draft: RecipeDraft, date: String) {
        val request = PatchNutritionRecipesByIdRequest(
            name = draft.name,
            servings = draft.servings,
            ingredients = draft.ingredients.map { PatchNutritionRecipesByIdRequest.IngredientsItem(it.foodId, it.quantityG) },
        )
        api.call(ApiEndpoints.PatchNutritionRecipesById, request, path = ApiEndpoints.PatchNutritionRecipesById.path(id))
        refreshRecipes()
        foodChanged(date)
    }

    public suspend fun deleteRecipe(id: String) {
        api.call(ApiEndpoints.DeleteNutritionRecipesById, path = ApiEndpoints.DeleteNutritionRecipesById.path(id))
        refreshRecipes()
    }

    private companion object {
        const val CUSTOM_KEY = "nutrition-foods:custom"
        const val RECIPES_KEY = "nutrition-foods:recipes"
        val FOODS = ListSerializer(NutritionFood.serializer())
        val RECIPES = ListSerializer(GetNutritionRecipesResponseItem.serializer())
    }
}
