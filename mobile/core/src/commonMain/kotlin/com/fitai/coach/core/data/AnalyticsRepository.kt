package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CoachInsights
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsQuery
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsResponseValueItem
import com.fitai.coach.core.api.generated.GetOverviewAnalysisQuery
import com.fitai.coach.core.api.generated.GetPersonalRecordsQuery
import com.fitai.coach.core.api.generated.GetRacePredictionQuery
import com.fitai.coach.core.api.generated.GetSessionGradesQuery
import com.fitai.coach.core.api.generated.GetTrainingOverviewQuery
import com.fitai.coach.core.api.generated.OverviewAnalysis
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.PostOverviewAnalysisQuery
import com.fitai.coach.core.api.generated.RacePrediction
import com.fitai.coach.core.api.generated.SessionGradesResponse
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.dates.addDaysToIsoDate
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer
import kotlinx.serialization.json.JsonPrimitive

/** The analytics date ranges (Analytics.tsx): the last N days, or everything. */
// The day counts are the ranges themselves.
@Suppress("MagicNumber")
public enum class AnalyticsRange(public val days: Int?, public val label: String) {
    Month(30, "30d"),
    Quarter(90, "90d"),
    HalfYear(180, "6m"),
    Year(365, "1y"),
    All(null, "All"),
    ;

    /** `from` and `to` for [today] (both inclusive); null for everything. */
    public fun bounds(today: String): Pair<String, String>? = days?.let { addDaysToIsoDate(today, -(it - 1)) to today }
}

/**
 * Training overview, personal records and exercise progression, cached per
 * range so a range already seen shows offline. Weights and distances come
 * back in the athlete's units.
 */
public class AnalyticsRepository(private val api: ApiClient, private val cache: CacheStore) {
    public fun overview(
        range: AnalyticsRange,
    ): Flow<TrainingOverview?> = cache.observe(key("overview", range), TrainingOverview.serializer())

    public fun records(range: AnalyticsRange): Flow<Map<String, PersonalRecord>?> = cache.observe(key("records", range), RECORDS)

    public fun exercises(range: AnalyticsRange): Flow<Map<String, List<GetExerciseAnalyticsResponseValueItem>>?> =
        cache.observe(key("exercises", range), EXERCISES)

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshOverview(range: AnalyticsRange, today: String) {
        val bounds = range.bounds(today)
        val query = GetTrainingOverviewQuery(from = bounds?.first, to = bounds?.second).toQueryParameters()
        cache.put(key("overview", range), TrainingOverview.serializer(), api.call(ApiEndpoints.GetTrainingOverview, query = query))
    }

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshRecords(range: AnalyticsRange, today: String) {
        val bounds = range.bounds(today)
        val query = GetPersonalRecordsQuery(from = bounds?.first, to = bounds?.second).toQueryParameters()
        cache.put(key("records", range), RECORDS, api.call(ApiEndpoints.GetPersonalRecords, query = query))
    }

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun refreshExercises(range: AnalyticsRange, today: String) {
        val bounds = range.bounds(today)
        val query = GetExerciseAnalyticsQuery(from = bounds?.first, to = bounds?.second).toQueryParameters()
        cache.put(key("exercises", range), EXERCISES, api.call(ApiEndpoints.GetExerciseAnalytics, query = query))
    }

    /** The last race prediction, kept so the tab paints at once (useRacePrediction's snapshot). */
    public val racePrediction: Flow<RacePrediction?> = cache.observe(RACE_PREDICTION, RacePrediction.serializer())

    /**
     * Fetches the race prediction: the stored one (no AI spend), or with
     * [regenerate] a fresh one, which may spend AI budget.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun refreshRacePrediction(regenerate: Boolean = false) {
        val query = GetRacePredictionQuery(refresh = "1".takeIf { regenerate }).toQueryParameters()
        cache.put(RACE_PREDICTION, RacePrediction.serializer(), api.call(ApiEndpoints.GetRacePrediction, query = query))
    }

    /**
     * Every graded run of [planId]'s plan (the active plan when null), by week
     * and block. Computed on read, so online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun sessionGrades(planId: String? = null): SessionGradesResponse =
        api.call(ApiEndpoints.GetSessionGrades, query = GetSessionGradesQuery(planId = planId).toQueryParameters())

    /** The last Coach Insights, kept on the device. */
    public val coachInsights: Flow<CoachInsights?> = cache.observe(COACH_INSIGHTS, CoachInsights.serializer())

    /** Fetches the stored Coach Insights, without spending AI. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshCoachInsights() {
        cache.put(COACH_INSIGHTS, CoachInsights.serializer(), api.call(ApiEndpoints.GetCoachInsights))
    }

    /** Runs the AI analysis now (tens of seconds) and keeps it. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun regenerateCoachInsights() {
        val result = api.call(ApiEndpoints.PostCoachInsights)
        cache.put(
            COACH_INSIGHTS,
            CoachInsights.serializer(),
            CoachInsights(insights = result.insights, ragInfo = result.ragInfo, generatedAt = result.generatedAt, stale = result.stale),
        )
    }

    /** The AI's reading of the Overview charts for [range], kept on the device per range. */
    public fun overviewAnalysis(range: AnalyticsRange): Flow<OverviewAnalysis?> =
        cache.observe(key("overview-analysis", range), OverviewAnalysis.serializer())

    /** Fetches the stored chart reading for [range], without spending AI. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshOverviewAnalysis(range: AnalyticsRange) {
        val query = GetOverviewAnalysisQuery(range = range.wire()).toQueryParameters()
        cache.put(key("overview-analysis", range), OverviewAnalysis.serializer(), api.call(ApiEndpoints.GetOverviewAnalysis, query = query))
    }

    /**
     * Reads the Overview charts for [range] with the AI now (tens of seconds)
     * and keeps it; the server keeps one range at a time.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun regenerateOverviewAnalysis(range: AnalyticsRange) {
        val query = PostOverviewAnalysisQuery(range = range.wire()).toQueryParameters()
        val result = api.call(ApiEndpoints.PostOverviewAnalysis, query = query)
        cache.put(
            key("overview-analysis", range),
            OverviewAnalysis.serializer(),
            OverviewAnalysis(result.sections, result.ragInfo, result.generatedAt, result.rangeDays, result.stale),
        )
    }

    private companion object {
        const val RACE_PREDICTION = "analytics:race-prediction"
        const val COACH_INSIGHTS = "analytics:coach-insights"
        val RECORDS = MapSerializer(String.serializer(), PersonalRecord.serializer())
        val EXERCISES = MapSerializer(String.serializer(), ListSerializer(GetExerciseAnalyticsResponseValueItem.serializer()))

        fun key(kind: String, range: AnalyticsRange) = "analytics:$kind:${range.name}"

        /** "90" or "all", as the analysis routes name a range. */
        fun AnalyticsRange.wire() = JsonPrimitive(days?.toString() ?: "all")
    }
}
