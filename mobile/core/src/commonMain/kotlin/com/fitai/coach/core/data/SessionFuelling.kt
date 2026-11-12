package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetNutritionPlannedSessionEstimateByPlanDayIdResponse
import com.fitai.coach.core.api.generated.GetNutritionSessionFuellingByWorkoutIdResponse
import com.fitai.coach.core.api.generated.GetNutritionSummaryRangeQuery
import com.fitai.coach.core.api.generated.GetNutritionSummaryRangeResponse
import kotlinx.coroutines.flow.Flow

/**
 * How eating lines up with training:
 * - what was eaten around a logged workout against what the session called
 *   for (FuellingAroundSessionPanel.tsx);
 * - the server's estimate of a planned session's duration and effort
 *   (FuellingPlanPanel.tsx);
 * - each day's intake against its target, for the timeline's chips
 *   (FuellingDayChip.tsx).
 *
 * The first and last are kept on the device under the day summaries' prefix,
 * so a change to every day's entries drops them too.
 */
public class SessionFuelling internal constructor(private val api: ApiClient, private val cache: CacheStore) {
    public fun aroundWorkout(
        workoutId: String,
    ): Flow<GetNutritionSessionFuellingByWorkoutIdResponse?> = cache.observe(workoutKey(workoutId), WORKOUT_SERIALIZER)

    /** @throws com.fitai.coach.core.api.ApiException on an error response (404 with nutrition off). */
    public suspend fun refreshAroundWorkout(workoutId: String) {
        val fuelling = api.call(
            ApiEndpoints.GetNutritionSessionFuellingByWorkoutId,
            path = ApiEndpoints.GetNutritionSessionFuellingByWorkoutId.path(workoutId),
        )
        cache.put(workoutKey(workoutId), WORKOUT_SERIALIZER, fuelling)
    }

    /**
     * The server's duration and effort for a planned session: worked out from
     * its exercises and distances, personalised from logged runs, and lightly
     * refined by the AI. Not kept: the sheet asks each time it opens.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun plannedEstimate(planDayId: String): GetNutritionPlannedSessionEstimateByPlanDayIdResponse = api.call(
        ApiEndpoints.GetNutritionPlannedSessionEstimateByPlanDayId,
        path = ApiEndpoints.GetNutritionPlannedSessionEstimateByPlanDayId.path(planDayId),
    )

    /** The last range of days fetched for the timeline's chips. */
    public val days: Flow<GetNutritionSummaryRangeResponse?> = cache.observe(RANGE_KEY, GetNutritionSummaryRangeResponse.serializer())

    /** Fetches [from] to [to] (inclusive, at most [MAX_RANGE_DAYS]). @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshDays(from: String, to: String) {
        val range = api.call(
            ApiEndpoints.GetNutritionSummaryRange,
            query = GetNutritionSummaryRangeQuery(from = from, to = to).toQueryParameters(),
        )
        cache.put(RANGE_KEY, GetNutritionSummaryRangeResponse.serializer(), range)
    }

    public companion object {
        /** The longest span /nutrition/summary-range takes (NUTRITION_RANGE_MAX_DAYS). */
        public const val MAX_RANGE_DAYS: Int = 731

        private val WORKOUT_SERIALIZER = GetNutritionSessionFuellingByWorkoutIdResponse.serializer()

        // Under the day summaries' prefix, so dropping every day drops these too.
        private const val RANGE_KEY = "nutrition:fuelling-days"

        private fun workoutKey(workoutId: String) = "nutrition:session-fuelling:$workoutId"
    }
}
