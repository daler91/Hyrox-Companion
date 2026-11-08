package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsQuery
import com.fitai.coach.core.api.generated.GetExerciseAnalyticsResponseValueItem
import com.fitai.coach.core.api.generated.GetPersonalRecordsQuery
import com.fitai.coach.core.api.generated.GetTrainingOverviewQuery
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.dates.addDaysToIsoDate
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.MapSerializer
import kotlinx.serialization.builtins.serializer

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

    private companion object {
        val RECORDS = MapSerializer(String.serializer(), PersonalRecord.serializer())
        val EXERCISES = MapSerializer(String.serializer(), ListSerializer(GetExerciseAnalyticsResponseValueItem.serializer()))

        fun key(kind: String, range: AnalyticsRange) = "analytics:$kind:${range.name}"
    }
}
