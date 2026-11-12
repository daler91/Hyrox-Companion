package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetNutritionInsightsResponse
import com.fitai.coach.core.api.generated.GetNutritionMicrosQuery
import com.fitai.coach.core.api.generated.GetNutritionMicrosResponse
import kotlinx.coroutines.flow.Flow

/**
 * What the food log adds up to: each day's micronutrients against reference
 * intakes (MicronutrientPanel.tsx) and the AI's nutrition insights
 * (NutritionInsightsPanel.tsx). Both are kept on the device. A day's micros sit
 * with its summary, so a change to every day's entries drops them too.
 */
public class NutritionReports internal constructor(private val api: ApiClient, private val cache: CacheStore) {
    public fun micros(
        date: String,
    ): Flow<GetNutritionMicrosResponse?> = cache.observe(microsKey(date), GetNutritionMicrosResponse.serializer())

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshMicros(date: String) {
        val micros = api.call(ApiEndpoints.GetNutritionMicros, query = GetNutritionMicrosQuery(date = date).toQueryParameters())
        cache.put(microsKey(date), GetNutritionMicrosResponse.serializer(), micros)
    }

    /** The last stored insights. */
    public val insights: Flow<GetNutritionInsightsResponse?> = cache.observe(INSIGHTS_KEY, GetNutritionInsightsResponse.serializer())

    /** Fetches the stored insights, without spending AI. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshInsights() {
        cache.put(INSIGHTS_KEY, GetNutritionInsightsResponse.serializer(), api.call(ApiEndpoints.GetNutritionInsights))
    }

    /** Runs the AI analysis now and keeps it. It needs the AI Coach on. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun regenerateInsights() {
        val result = api.call(ApiEndpoints.PostNutritionInsights)
        cache.put(
            INSIGHTS_KEY,
            GetNutritionInsightsResponse.serializer(),
            GetNutritionInsightsResponse(insights = result.insights, generatedAt = result.generatedAt, stale = result.stale),
        )
    }

    private companion object {
        // Under the day summaries' prefix, so dropping every day drops these too.
        fun microsKey(date: String) = "nutrition:micros:$date"

        const val INSIGHTS_KEY = "nutrition-insights"
    }
}
