package com.fitai.coach.core.health

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ActiveCaloriesBurnedRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import java.time.Duration
import java.time.Instant

/**
 * Health Connect as the app's HealthDataSource: exercise sessions, with the
 * heart rate, distance and active calories the same app recorded over each
 * session's span. Read-only; the app writes nothing to Health Connect.
 */
public class HealthConnectSource(private val context: Context) : HealthDataSource {
    private val client by lazy { HealthConnectClient.getOrCreate(context) }

    override suspend fun availability(): HealthAvailability = when (HealthConnectClient.getSdkStatus(context)) {
        HealthConnectClient.SDK_AVAILABLE -> HealthAvailability.Available
        HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> HealthAvailability.NeedsInstall
        else -> HealthAvailability.Unsupported
    }

    override suspend fun hasPermissions(): Boolean =
        availability() == HealthAvailability.Available && client.permissionController.getGrantedPermissions().containsAll(READ_PERMISSIONS)

    /** What to ask for: the reads, plus reading in the background where Health Connect supports it. */
    public suspend fun permissionsToRequest(): Set<String> {
        val background = client.features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) ==
            HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
        return if (background) READ_PERMISSIONS + HealthPermission.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND else READ_PERMISSIONS
    }

    /** Withdraws everything the app was granted (Settings → disconnect). */
    override suspend fun revokePermissions() {
        if (availability() == HealthAvailability.Available) client.permissionController.revokeAllPermissions()
    }

    override suspend fun changesSince(token: String?): HealthChanges {
        if (token != null) {
            readChanges(token)?.let { return it }
        }
        return backfill()
    }

    /** Pages through the Changes API from [token]; null when the token has expired. */
    private suspend fun readChanges(token: String): HealthChanges? {
        val sessions = mutableListOf<ExerciseSessionRecord>()
        val deleted = mutableListOf<String>()
        var next = token
        do {
            val response = client.getChanges(next)
            if (response.changesTokenExpired) return null
            response.changes.forEach { change ->
                when (change) {
                    is UpsertionChange -> (change.record as? ExerciseSessionRecord)?.let(sessions::add)
                    is DeletionChange -> deleted += change.recordId
                }
            }
            next = response.nextChangesToken
        } while (response.hasMore)
        return HealthChanges(sessions.mapNotNull { it.toSession() }, deleted, next)
    }

    /** The last HEALTH_BACKFILL_DAYS days. The token comes first, so nothing written meanwhile is missed. */
    private suspend fun backfill(): HealthChanges {
        val token = client.getChangesToken(ChangesTokenRequest(setOf(ExerciseSessionRecord::class)))
        val since = Instant.now().minus(Duration.ofDays(HEALTH_BACKFILL_DAYS.toLong()))
        val sessions = mutableListOf<ExerciseSessionRecord>()
        var page: String? = null
        do {
            val response = client.readRecords(
                ReadRecordsRequest(ExerciseSessionRecord::class, TimeRangeFilter.after(since), pageSize = PAGE_SIZE, pageToken = page),
            )
            sessions += response.records
            page = response.pageToken
        } while (page != null)
        return HealthChanges(sessions.mapNotNull { it.toSession() }, emptyList(), token)
    }

    private suspend fun ExerciseSessionRecord.toSession(): HealthSession? {
        val span = Duration.between(startTime, endTime)
        if (span.isNegative || span.isZero || span > MAX_SESSION) return null
        val origin = metadata.dataOrigin
        val totals = client.aggregate(
            AggregateRequest(
                metrics = setOf(
                    HeartRateRecord.BPM_AVG,
                    HeartRateRecord.BPM_MAX,
                    DistanceRecord.DISTANCE_TOTAL,
                    ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL,
                ),
                timeRangeFilter = TimeRangeFilter.between(startTime, endTime),
                // The session's own app: a phone's step distance must not land on a ride.
                dataOriginFilter = setOf(origin),
            ),
        )
        return HealthSession(
            id = metadata.id,
            startTime = startTime.toString(),
            endTime = endTime.toString(),
            zoneOffsetMinutes = startZoneOffset?.totalSeconds?.div(SECONDS_PER_MINUTE),
            sportType = sportTypeFor(exerciseType),
            title = title,
            distanceMeters = totals[DistanceRecord.DISTANCE_TOTAL]?.inMeters,
            activeCalories = totals[ActiveCaloriesBurnedRecord.ACTIVE_CALORIES_TOTAL]?.inKilocalories,
            avgHeartRate = totals[HeartRateRecord.BPM_AVG]?.toInt()?.takeIf { it in HEART_RATE_RANGE },
            maxHeartRate = totals[HeartRateRecord.BPM_MAX]?.toInt()?.takeIf { it in HEART_RATE_RANGE },
            dataOrigin = origin.packageName,
        )
    }

    public companion object {
        /** The reads the sync needs (declared in androidApp's manifest). */
        public val READ_PERMISSIONS: Set<String> = setOf(
            HealthPermission.getReadPermission(ExerciseSessionRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(DistanceRecord::class),
            HealthPermission.getReadPermission(ActiveCaloriesBurnedRecord::class),
        )

        private const val PAGE_SIZE = 500
        private const val SECONDS_PER_MINUTE = 60
        private val MAX_SESSION: Duration = Duration.ofHours(24)

        // The server's accepted range (healthConnectSessionSchema).
        private val HEART_RATE_RANGE = 20..250
    }
}

/**
 * Health Connect's exercise type as Strava's sport-type name, the vocabulary
 * the server's matcher, analytics and training-load rules already speak
 * (shared/deviceSportTypes.ts, deviceActivityMatcher.ts).
 */
internal fun sportTypeFor(exerciseType: Int): String = SPORT_TYPES[exerciseType] ?: "Workout"

private val SPORT_TYPES: Map<Int, String> = buildMap {
    fun map(name: String, vararg types: Int) = types.forEach { put(it, name) }
    map("Run", ExerciseSessionRecord.EXERCISE_TYPE_RUNNING, ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL)
    map("Ride", ExerciseSessionRecord.EXERCISE_TYPE_BIKING, ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY)
    map("Walk", ExerciseSessionRecord.EXERCISE_TYPE_WALKING)
    map("Hike", ExerciseSessionRecord.EXERCISE_TYPE_HIKING)
    map("Swim", ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL, ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER)
    map("Rowing", ExerciseSessionRecord.EXERCISE_TYPE_ROWING, ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE)
    map("WeightTraining", ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING, ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING)
    map("HighIntensityIntervalTraining", ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING)
    map(
        "Crossfit",
        ExerciseSessionRecord.EXERCISE_TYPE_BOOT_CAMP,
        ExerciseSessionRecord.EXERCISE_TYPE_CALISTHENICS,
        ExerciseSessionRecord.EXERCISE_TYPE_EXERCISE_CLASS,
    )
    map("Elliptical", ExerciseSessionRecord.EXERCISE_TYPE_ELLIPTICAL)
    map("StairStepper", ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING, ExerciseSessionRecord.EXERCISE_TYPE_STAIR_CLIMBING_MACHINE)
    map("Yoga", ExerciseSessionRecord.EXERCISE_TYPE_YOGA)
    map("Pilates", ExerciseSessionRecord.EXERCISE_TYPE_PILATES)
}
