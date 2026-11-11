package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.NutritionFoodWithPortionMemory
import com.fitai.coach.core.api.generated.PostNutritionFavoritesRequest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer

/**
 * The foods the athlete reaches for: the ones they log most and the ones they
 * starred, each with the portion and meal it was last logged in. Both lists
 * are kept on the device, so the shortcuts show offline.
 */
public class FoodShortcuts internal constructor(private val api: ApiClient, private val cache: CacheStore) {
    /** Up to 20 foods the athlete logs most (GET /foods/recent). */
    public fun recentFoods(): Flow<List<NutritionFoodWithPortionMemory>?> = cache.observe(RECENT_KEY, FOOD_LIST)

    /** The starred foods, newest first. */
    public fun favorites(): Flow<List<NutritionFoodWithPortionMemory>?> = cache.observe(FAVORITES_KEY, FOOD_LIST)

    public suspend fun refreshRecentFoods() {
        cache.put(RECENT_KEY, FOOD_LIST, api.call(ApiEndpoints.GetNutritionFoodsRecent))
    }

    public suspend fun refreshFavorites() {
        cache.put(FAVORITES_KEY, FOOD_LIST, api.call(ApiEndpoints.GetNutritionFavorites))
    }

    /**
     * Stars or un-stars a food, then refreshes the favourites. Un-starring one
     * that is already gone (a 404) has done what was asked (useToggleFavorite).
     */
    public suspend fun setFavorite(foodId: String, favorite: Boolean) {
        if (favorite) {
            api.call(ApiEndpoints.PostNutritionFavorites, PostNutritionFavoritesRequest(foodId = foodId))
        } else {
            try {
                api.call(ApiEndpoints.DeleteNutritionFavoritesByFoodId, path = ApiEndpoints.DeleteNutritionFavoritesByFoodId.path(foodId))
            } catch (e: ApiException) {
                if (e.status != NOT_FOUND) throw e
            }
        }
        refreshFavorites()
    }

    /**
     * What was just logged moves up the recent foods. The list is a shortcut,
     * so failing to refresh it keeps the old one rather than failing the log.
     */
    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    internal suspend fun refreshRecentFoodsAfterLogging() {
        try {
            refreshRecentFoods()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Kept as it was; the next refresh catches up.
        }
    }

    private companion object {
        const val NOT_FOUND = 404
        const val RECENT_KEY = "nutrition-foods:recent"
        const val FAVORITES_KEY = "nutrition-foods:favorites"
        val FOOD_LIST = ListSerializer(NutritionFoodWithPortionMemory.serializer())
    }
}
