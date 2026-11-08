package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetNutritionFoodsByIdResponse
import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchQuery
import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchResponse
import com.fitai.coach.core.api.generated.GetNutritionSummaryQuery
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionTarget
import com.fitai.coach.core.api.generated.PatchNutritionLogsByIdRequest
import com.fitai.coach.core.api.generated.PostNutritionLogsRequest
import com.fitai.coach.core.api.generated.PostNutritionTargetsRequest
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject

/** The meals of a day, in the web's order (shared/schema/enums.ts MEAL_TYPES). */
public enum class Meal(public val wireValue: String, public val label: String) {
    Breakfast("breakfast", "Breakfast"),
    Lunch("lunch", "Lunch"),
    Dinner("dinner", "Dinner"),
    Snack("snack", "Snack"),
    SnackPm("snack_pm", "Afternoon snack"),
    PreWorkout("pre_workout", "Pre-workout"),
    PostWorkout("post_workout", "Post-workout"),
}

/** Daily macro targets as the athlete types them; a null field is not targeted. */
public data class MacroTargets(val calories: Double?, val proteinG: Double?, val carbG: Double?, val fatG: Double?)

/** Nutrition is switched off on the server (every /nutrition call is a 404 NOT_FOUND). */
public fun ApiException.isNutritionOff(): Boolean = status == NOT_FOUND && code == "NOT_FOUND"

private const val NOT_FOUND = 404

/**
 * The food log: each day's summary (totals, meals, targets) is cached, so a
 * day already seen shows offline. Searching and changes are online; each
 * change refreshes its day.
 */
public class NutritionRepository(private val api: ApiClient, private val cache: CacheStore) {
    public fun day(date: String): Flow<GetNutritionSummaryResponse?> = cache.observe(dayKey(date), GetNutritionSummaryResponse.serializer())

    /** @throws ApiException on an error response ([isNutritionOff] when the feature is off). */
    public suspend fun refreshDay(date: String) {
        val summary = api.call(ApiEndpoints.GetNutritionSummary, query = GetNutritionSummaryQuery(date = date).toQueryParameters())
        cache.put(dayKey(date), GetNutritionSummaryResponse.serializer(), summary)
    }

    public suspend fun search(query: String): GetNutritionFoodsSearchResponse =
        api.call(ApiEndpoints.GetNutritionFoodsSearch, query = GetNutritionFoodsSearchQuery(q = query.trim()).toQueryParameters())

    public suspend fun food(id: String): GetNutritionFoodsByIdResponse =
        api.call(ApiEndpoints.GetNutritionFoodsById, path = ApiEndpoints.GetNutritionFoodsById.path(id))

    /** Logs [quantityG] grams of a food to [meal] on [date]; [loggedAt] is an ISO timestamp the server dates by the athlete's timezone. */
    public suspend fun log(foodId: String, quantityG: Double, meal: Meal, loggedAt: String, date: String) {
        val request = PostNutritionLogsRequest(
            foodId = foodId,
            quantityG = quantityG,
            mealType = PostNutritionLogsRequest.MealType.entries.first { it.wireValue == meal.wireValue },
            loggedAt = loggedAt,
        )
        write(
            ApiEndpoints.PostNutritionLogs,
            ApiEndpoints.PostNutritionLogs.pathTemplate,
            encode(PostNutritionLogsRequest.serializer(), request),
        )
        refreshDay(date)
    }

    /** Changes an entry's meal, and its amount when [quantityG] is set. */
    public suspend fun updateEntry(id: String, meal: Meal, quantityG: Double?, date: String) {
        val request = PatchNutritionLogsByIdRequest(
            quantityG = quantityG,
            mealType = PatchNutritionLogsByIdRequest.MealType.entries.first { it.wireValue == meal.wireValue },
        )
        write(
            ApiEndpoints.PatchNutritionLogsById,
            ApiEndpoints.PatchNutritionLogsById.path(id),
            encode(PatchNutritionLogsByIdRequest.serializer(), request),
        )
        refreshDay(date)
    }

    public suspend fun deleteEntry(id: String, date: String) {
        api.call(ApiEndpoints.DeleteNutritionLogsById, path = ApiEndpoints.DeleteNutritionLogsById.path(id))
        refreshDay(date)
    }

    public suspend fun currentTargets(): NutritionTarget? = api.call(ApiEndpoints.GetNutritionTargets).current

    /**
     * Saves the daily macro targets. The athlete's training-load settings on
     * the current target (periodisation, recovery, preload) are carried over
     * unchanged, so editing a macro never resets them. Refreshes [date].
     */
    public suspend fun saveTargets(targets: MacroTargets, date: String) {
        val current = currentTargets()
        // The new targets take effect now: the old target's start date stays behind.
        val carried = current?.let { ApiJson.encodeToJsonElement(NutritionTarget.serializer(), it).jsonObject - NOT_CARRIED }.orEmpty()
        val macros = mapOf(
            "calories" to targets.calories,
            "proteinG" to targets.proteinG,
            "carbG" to targets.carbG,
            "fatG" to targets.fatG,
        ).mapValues { (_, v) -> v?.let(::JsonPrimitive) ?: JsonNull }
        val request = ApiJson.decodeFromJsonElement(PostNutritionTargetsRequest.serializer(), JsonObject(carried + macros))
        write(
            ApiEndpoints.PostNutritionTargets,
            ApiEndpoints.PostNutritionTargets.pathTemplate,
            encode(PostNutritionTargetsRequest.serializer(), request),
        )
        cache.deletePrefix(DAY_PREFIX)
        refreshDay(date)
    }

    // Writes whose answer isn't read: the day's refresh shows the result.
    private suspend fun write(endpoint: com.fitai.coach.core.api.ApiEndpoint<*, *>, path: String, body: String) {
        api.send(endpoint, path, body, idempotencyKey = null)
    }

    private companion object {
        const val DAY_PREFIX = "nutrition:"
        val NOT_CARRIED = setOf("id", "userId", "effectiveFrom", "createdAt", "updatedAt")

        fun dayKey(date: String) = DAY_PREFIX + date
    }
}
