package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetNutritionFoodsByIdResponse
import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchQuery
import com.fitai.coach.core.api.generated.GetNutritionFoodsSearchResponse
import com.fitai.coach.core.api.generated.GetNutritionSummaryQuery
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.core.api.generated.NutritionParseMealResponse
import com.fitai.coach.core.api.generated.PatchNutritionLogsByIdRequest
import com.fitai.coach.core.api.generated.PostNutritionLogsBatchRequest
import com.fitai.coach.core.api.generated.PostNutritionLogsRepeatRequest
import com.fitai.coach.core.api.generated.PostNutritionLogsRequest
import com.fitai.coach.core.api.generated.PostNutritionParsePhotoRequest
import com.fitai.coach.core.api.generated.PostNutritionParseTextRequest
import kotlinx.coroutines.flow.Flow

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

/** How a reviewed meal was captured: described in words, or from a photo. */
public enum class MealEntryMethod { Described, Photo }

/** One reviewed food to log: [confidence] is the parser's, kept with the entry. */
public data class MealItem(val foodId: String, val quantityG: Double, val meal: Meal, val confidence: Double?)

/** Daily macro targets as the athlete types them; a null field is not targeted. */
public data class MacroTargets(val calories: Double?, val proteinG: Double?, val carbG: Double?, val fatG: Double?)

/**
 * Nothing to copy: the day (or meal) asked to be repeated has no entries. Only
 * [NutritionRepository.repeat] answers with this 404; elsewhere it means [isNutritionOff].
 */
public fun ApiException.isNothingToRepeat(): Boolean = status == NOT_FOUND

/** Nutrition is switched off on the server (every /nutrition call is a 404 NOT_FOUND). */
public fun ApiException.isNutritionOff(): Boolean = status == NOT_FOUND && code == "NOT_FOUND"

private const val NOT_FOUND = 404

/**
 * The food log: each day's summary (totals, meals, targets) is cached, so a
 * day already seen shows offline, and so are the recent and favourite foods
 * ([shortcuts]).
 * Searching and changes are online; each change refreshes its day.
 */
public class NutritionRepository(private val api: ApiClient, private val cache: CacheStore) {
    /** The recent and favourite foods, which each log refreshes. */
    public val shortcuts: FoodShortcuts = FoodShortcuts(api, cache)

    /** The athlete's custom foods, portions and recipes. */
    public val myFoods: MyFoods = MyFoods(api, cache) { date -> refreshAllDays(date) }

    /** The daily and per-meal targets. */
    public val targets: TargetSettings = TargetSettings(api) { date -> refreshAllDays(date) }

    /** Each day's micronutrients and the AI's nutrition insights. */
    public val reports: NutritionReports = NutritionReports(api, cache)

    /** Fuelling around sessions, planned and logged, and each day's for the timeline. */
    public val fuelling: SessionFuelling = SessionFuelling(api, cache)

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

    /**
     * Logs [quantityG] grams of a food to [meal] on [date]; [loggedAt] is an
     * ISO timestamp the server dates by the athlete's timezone. Returns the new
     * entry's id (for an undo).
     */
    public suspend fun log(foodId: String, quantityG: Double, meal: Meal, loggedAt: String, date: String): String {
        val request = PostNutritionLogsRequest(
            foodId = foodId,
            quantityG = quantityG,
            mealType = PostNutritionLogsRequest.MealType.entries.first { it.wireValue == meal.wireValue },
            loggedAt = loggedAt,
        )
        val entry = api.call(ApiEndpoints.PostNutritionLogs, request)
        refreshDay(date)
        shortcuts.refreshRecentFoodsAfterLogging()
        return entry.id
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

    /**
     * The AI's reading of a described meal: suggested foods and portions to
     * review. Nothing is logged.
     *
     * @throws ApiException 403 AI_COACH_DISABLED without AI consent, 429 over the budget.
     */
    public suspend fun parseMealText(text: String): NutritionParseMealResponse =
        api.call(ApiEndpoints.PostNutritionParseText, PostNutritionParseTextRequest(text = text.trim().take(MAX_MEAL_TEXT)))

    /** As [parseMealText], from a photo of the meal. */
    public suspend fun parseMealPhoto(image: EncodedImage): NutritionParseMealResponse {
        val mime = PostNutritionParsePhotoRequest.MimeType.entries.firstOrNull { it.wireValue == image.mimeType }
            ?: PostNutritionParsePhotoRequest.MimeType.ImageJpeg
        return api.call(ApiEndpoints.PostNutritionParsePhoto, PostNutritionParsePhotoRequest(mimeType = mime, imageBase64 = image.base64))
    }

    /**
     * Logs reviewed foods in one write, all at [loggedAt] (the confirm step
     * after a parse), then refreshes [date]. Returns how many were logged.
     */
    public suspend fun logMeal(method: MealEntryMethod, rawInput: String?, loggedAt: String, items: List<MealItem>, date: String): Long {
        val request = PostNutritionLogsBatchRequest(
            entryMethod = when (method) {
                MealEntryMethod.Described -> PostNutritionLogsBatchRequest.EntryMethod.Nl
                MealEntryMethod.Photo -> PostNutritionLogsBatchRequest.EntryMethod.Photo
            },
            rawInput = rawInput,
            loggedAt = loggedAt,
            items = items.map { item ->
                PostNutritionLogsBatchRequest.ItemsItem(
                    foodId = item.foodId,
                    quantityG = item.quantityG,
                    mealType = PostNutritionLogsBatchRequest.ItemsItem.MealType.entries.first { it.wireValue == item.meal.wireValue },
                    parseConfidence = item.confidence,
                )
            },
        )
        val created = api.call(ApiEndpoints.PostNutritionLogsBatch, request).created
        refreshDay(date)
        shortcuts.refreshRecentFoodsAfterLogging()
        return created
    }

    /**
     * Copies [sourceDate]'s entries (only [meal]'s, when set) onto
     * [targetDate], then refreshes it. Returns how many were copied.
     *
     * @throws ApiException [isNothingToRepeat] when there is nothing to copy.
     */
    public suspend fun repeat(sourceDate: String, targetDate: String, meal: Meal? = null): Long {
        val request = PostNutritionLogsRepeatRequest(
            sourceDate = sourceDate,
            mealType = meal?.let { m -> PostNutritionLogsRepeatRequest.MealType.entries.first { it.wireValue == m.wireValue } },
            targetDate = targetDate,
        )
        val created = api.call(ApiEndpoints.PostNutritionLogsRepeat, request).created
        refreshDay(targetDate)
        shortcuts.refreshRecentFoodsAfterLogging()
        return created
    }

    // A change every day's entries read (a target, a food's nutrition): the
    // cached days are dropped and [date] is fetched again.
    private suspend fun refreshAllDays(date: String) {
        cache.deletePrefix(DAY_PREFIX)
        refreshDay(date)
    }

    // Writes whose answer isn't read: the day's refresh shows the result.
    private suspend fun write(endpoint: com.fitai.coach.core.api.ApiEndpoint<*, *>, path: String, body: String) {
        api.send(endpoint, path, body, idempotencyKey = null)
    }

    private companion object {
        const val DAY_PREFIX = "nutrition:"

        /** The longest description the parser takes (DescribeMealDialog's limit). */
        const val MAX_MEAL_TEXT = 2000

        fun dayKey(date: String) = DAY_PREFIX + date
    }
}
