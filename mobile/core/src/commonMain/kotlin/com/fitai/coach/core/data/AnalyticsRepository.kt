package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CoachInsights
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsQuery
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsResponseValueItem
import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.GetNutritionBlockQuery
import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.core.api.generated.GetOverviewAnalysisQuery
import com.fitai.coach.core.api.generated.GetPersonalRecordsQuery
import com.fitai.coach.core.api.generated.GetRacePredictionQuery
import com.fitai.coach.core.api.generated.GetSessionGradesQuery
import com.fitai.coach.core.api.generated.GetTrainingOverviewQuery
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.api.generated.MafWorkoutAnalysis
import com.fitai.coach.core.api.generated.OverviewAnalysis
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdMafTestRequest
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.PostOverviewAnalysisQuery
import com.fitai.coach.core.api.generated.PostWorkoutsByIdMafTestRequest
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
        cache.observe(key(OVERVIEW_ANALYSIS, range), OverviewAnalysis.serializer())

    /** Fetches the stored chart reading for [range], without spending AI. @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshOverviewAnalysis(range: AnalyticsRange) {
        val query = GetOverviewAnalysisQuery(range = range.wire()).toQueryParameters()
        cache.put(key(OVERVIEW_ANALYSIS, range), OverviewAnalysis.serializer(), api.call(ApiEndpoints.GetOverviewAnalysis, query = query))
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
            key(OVERVIEW_ANALYSIS, range),
            OverviewAnalysis.serializer(),
            OverviewAnalysis(result.sections, result.ragInfo, result.generatedAt, result.rangeDays, result.stale),
        )
    }

    /** MAF tests and their compliance, newest first; not tied to the range. */
    public val mafTests: Flow<GetMafTestsResponse?> = cache.observe(MAF_TESTS, GetMafTestsResponse.serializer())

    /** @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refreshMafTests() {
        cache.put(MAF_TESTS, GetMafTestsResponse.serializer(), api.call(ApiEndpoints.GetMafTests))
    }

    /**
     * Tags a run as a MAF test, scored against the athlete's ceiling when it
     * has an average heart rate. [metrics] replace the run's own; a null one
     * is left out of the test. The kept list takes the new test. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun tagMafTest(workoutId: String, metrics: MafMetrics) {
        val body = PostWorkoutsByIdMafTestRequest(
            metrics = PostWorkoutsByIdMafTestRequest.Metrics(
                avgHeartRate = Patch.of(metrics.avgHeartRate),
                maxHeartRate = Patch.of(metrics.maxHeartRate),
                durationSeconds = Patch.of(metrics.durationSeconds),
                distanceMeters = Patch.of(metrics.distanceMeters),
            ),
        )
        val saved = api.call(ApiEndpoints.PostWorkoutsByIdMafTest, body, ApiEndpoints.PostWorkoutsByIdMafTest.path(workoutId))
        keepMafTest(workoutId, saved.testResult, saved.analysis)
    }

    /**
     * Corrects a tagged run's metrics (null clears one) and rescores it; the
     * kept list takes the corrected test. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun updateMafTest(workoutId: String, metrics: MafMetrics) {
        val body = PatchWorkoutsByIdMafTestRequest(
            metrics = PatchWorkoutsByIdMafTestRequest.Metrics(
                avgHeartRate = Patch.of(metrics.avgHeartRate),
                maxHeartRate = Patch.of(metrics.maxHeartRate),
                durationSeconds = Patch.of(metrics.durationSeconds),
                distanceMeters = Patch.of(metrics.distanceMeters),
            ),
        )
        val saved = api.call(ApiEndpoints.PatchWorkoutsByIdMafTest, body, ApiEndpoints.PatchWorkoutsByIdMafTest.path(workoutId))
        keepMafTest(workoutId, saved.testResult, saved.analysis)
    }

    /**
     * Takes a run out of the MAF trend, its compliance score too, here and
     * on the server. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun untagMafTest(workoutId: String) {
        api.call(ApiEndpoints.DeleteWorkoutsByIdMafTest, path = ApiEndpoints.DeleteWorkoutsByIdMafTest.path(workoutId))
        keepMafTest(workoutId, test = null, analysis = null)
    }

    /**
     * Puts the server's answer in the kept list: a corrected test keeps its
     * place, a new one goes first (newest first), null takes the run out. A
     * test without a heart rate has no score, so its old score goes.
     */
    private suspend fun keepMafTest(workoutId: String, test: MafTestResult?, analysis: MafWorkoutAnalysis?) {
        val kept = cache.get(MAF_TESTS, GetMafTestsResponse.serializer()) ?: GetMafTestsResponse(emptyList(), emptyList(), emptyMap())
        cache.put(
            MAF_TESTS,
            GetMafTestsResponse.serializer(),
            kept.copy(
                tests = kept.tests.replacing(test) { it.conditions?.workoutLogId == workoutId },
                analysis = kept.analysis.replacing(analysis) { it.workoutLogId == workoutId },
            ),
        )
    }

    /** Daily intake against training load over [range], kept on the device per range. */
    public fun nutritionBlock(range: AnalyticsRange): Flow<GetNutritionBlockResponse?> =
        cache.observe(key(NUTRITION_BLOCK, range), GetNutritionBlockResponse.serializer())

    /**
     * Fetches [range]'s intake against training. "All" is held to the last
     * [MAX_BLOCK_DAYS] days, so years of empty days don't crowd the chart
     * (useFuellingAnalytics).
     *
     * @throws com.fitai.coach.core.api.ApiException
     */
    public suspend fun refreshNutritionBlock(range: AnalyticsRange, today: String) {
        val from = range.bounds(today)?.first ?: addDaysToIsoDate(today, -MAX_BLOCK_DAYS)
        val query = GetNutritionBlockQuery(from = from, to = today).toQueryParameters()
        cache.put(
            key(NUTRITION_BLOCK, range),
            GetNutritionBlockResponse.serializer(),
            api.call(ApiEndpoints.GetNutritionBlock, query = query),
        )
    }

    private companion object {
        const val MAF_TESTS = "analytics:maf-tests"
        const val NUTRITION_BLOCK = "nutrition-block"
        const val MAX_BLOCK_DAYS = 365
        const val RACE_PREDICTION = "analytics:race-prediction"
        const val OVERVIEW_ANALYSIS = "overview-analysis"
        const val COACH_INSIGHTS = "analytics:coach-insights"
        val RECORDS = MapSerializer(String.serializer(), PersonalRecord.serializer())
        val EXERCISES = MapSerializer(String.serializer(), ListSerializer(GetExerciseAnalyticsResponseValueItem.serializer()))

        fun key(kind: String, range: AnalyticsRange) = "analytics:$kind:${range.name}"

        /** "90" or "all", as the analysis routes name a range. */
        fun AnalyticsRange.wire() = JsonPrimitive(days?.toString() ?: "all")
    }
}

/** The list with [item] in place of what [matches] (first when nothing does), or without it when [item] is null. */
private fun <T : Any> List<T>.replacing(item: T?, matches: (T) -> Boolean): List<T> {
    val rest = filterNot(matches)
    val at = indexOfFirst(matches)
    return when {
        item == null -> rest
        at < 0 -> listOf(item) + rest
        else -> rest.toMutableList().apply { add(at, item) }
    }
}
