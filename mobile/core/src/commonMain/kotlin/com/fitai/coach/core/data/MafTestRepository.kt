package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetMafTestsResponse
import com.fitai.coach.core.api.generated.MafTestResult
import com.fitai.coach.core.api.generated.MafWorkoutAnalysis
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdMafTestRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdMafTestRequest
import kotlinx.coroutines.flow.Flow

/**
 * A MAF-method athlete's MAF tests: runs tagged to track pace at the same
 * heart rate over time, each scored against their ceiling. Kept on the device
 * for the Analytics trend and each workout's tag.
 */
public class MafTestRepository(private val api: ApiClient, private val cache: CacheStore) {
    /** The tests and their compliance, newest first. */
    public val tests: Flow<GetMafTestsResponse?> = cache.observe(KEY, GetMafTestsResponse.serializer())

    /** @throws com.fitai.coach.core.api.ApiException */
    public suspend fun refresh() {
        cache.put(KEY, GetMafTestsResponse.serializer(), api.call(ApiEndpoints.GetMafTests))
    }

    /**
     * Tags a run as a MAF test, scored when it has an average heart rate.
     * [metrics] replace the run's own; a null one is left out of the test.
     * The kept list takes the new test. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun tag(workoutId: String, metrics: MafMetrics) {
        val body = PostWorkoutsByIdMafTestRequest(
            metrics = PostWorkoutsByIdMafTestRequest.Metrics(
                avgHeartRate = Patch.of(metrics.avgHeartRate),
                maxHeartRate = Patch.of(metrics.maxHeartRate),
                durationSeconds = Patch.of(metrics.durationSeconds),
                distanceMeters = Patch.of(metrics.distanceMeters),
            ),
        )
        val saved = api.call(ApiEndpoints.PostWorkoutsByIdMafTest, body, ApiEndpoints.PostWorkoutsByIdMafTest.path(workoutId))
        keep(workoutId, saved.testResult, saved.analysis)
    }

    /**
     * Corrects a tagged run's metrics (null clears one) and rescores it; the
     * kept list takes the corrected test. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun update(workoutId: String, metrics: MafMetrics) {
        val body = PatchWorkoutsByIdMafTestRequest(
            metrics = PatchWorkoutsByIdMafTestRequest.Metrics(
                avgHeartRate = Patch.of(metrics.avgHeartRate),
                maxHeartRate = Patch.of(metrics.maxHeartRate),
                durationSeconds = Patch.of(metrics.durationSeconds),
                distanceMeters = Patch.of(metrics.distanceMeters),
            ),
        )
        val saved = api.call(ApiEndpoints.PatchWorkoutsByIdMafTest, body, ApiEndpoints.PatchWorkoutsByIdMafTest.path(workoutId))
        keep(workoutId, saved.testResult, saved.analysis)
    }

    /**
     * Takes a run out of the MAF trend, its compliance score too, here and on
     * the server. Online.
     *
     * @throws com.fitai.coach.core.api.ApiException on an error response.
     */
    public suspend fun untag(workoutId: String) {
        api.call(ApiEndpoints.DeleteWorkoutsByIdMafTest, path = ApiEndpoints.DeleteWorkoutsByIdMafTest.path(workoutId))
        keep(workoutId, test = null, analysis = null)
    }

    /**
     * Puts the server's answer in the kept list: a corrected test keeps its
     * place, a new one goes first (newest first), null takes the run out. A
     * test without a heart rate has no score, so its old score goes.
     */
    private suspend fun keep(workoutId: String, test: MafTestResult?, analysis: MafWorkoutAnalysis?) {
        val kept = cache.get(KEY, GetMafTestsResponse.serializer()) ?: GetMafTestsResponse(emptyList(), emptyList(), emptyMap())
        cache.put(
            KEY,
            GetMafTestsResponse.serializer(),
            kept.copy(
                tests = kept.tests.replacing(test) { it.conditions?.workoutLogId == workoutId },
                analysis = kept.analysis.replacing(analysis) { it.workoutLogId == workoutId },
            ),
        )
    }

    private companion object {
        /** Where Analytics kept the list before it had its own repository, so a device's list carries over. */
        const val KEY = "analytics:maf-tests"
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
