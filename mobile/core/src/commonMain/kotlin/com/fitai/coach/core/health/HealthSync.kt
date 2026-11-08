package com.fitai.coach.core.health

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PostHealthConnectSyncRequest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** Whether the device's health data store can be used. */
public enum class HealthAvailability {
    /** The device can't run it (Health Connect needs Android 9+). */
    Unsupported,

    /** It must be installed or updated first. */
    NeedsInstall,
    Available,
}

/** A workout as the platform's health store holds it, with totals over its span. */
public data class HealthSession(
    val id: String,
    /** ISO 8601 instants. */
    val startTime: String,
    val endTime: String,
    val zoneOffsetMinutes: Int?,
    /** Strava's sport-type name ("Run", "Ride", "WeightTraining"), which the server understands. */
    val sportType: String,
    val title: String? = null,
    val distanceMeters: Double? = null,
    val activeCalories: Double? = null,
    val avgHeartRate: Int? = null,
    val maxHeartRate: Int? = null,
    /** The app that wrote it (a package name on Android). */
    val dataOrigin: String? = null,
)

/** What changed since a token: sessions written or updated, sessions deleted, and where to read from next. */
public data class HealthChanges(val sessions: List<HealthSession>, val deletedIds: List<String>, val nextToken: String)

/** The platform's health store (Health Connect on Android, HealthKit later). */
public interface HealthDataSource {
    public suspend fun availability(): HealthAvailability

    /** Whether every read permission the sync needs is granted. */
    public suspend fun hasPermissions(): Boolean

    /**
     * Changes since [token]; with no token (a first sync, or one the store
     * expired) the last [HEALTH_BACKFILL_DAYS] days. Reads only; never writes.
     */
    public suspend fun changesSince(token: String?): HealthChanges
}

/** How far back a first sync reads. */
public const val HEALTH_BACKFILL_DAYS: Int = 30

/** Kept on the device: who turned the sync on, and each user's read position. */
public interface HealthSyncStore {
    public var enabledFor: String?

    public fun token(userId: String): String?

    public fun saveToken(userId: String, token: String?)
}

public data class HealthSyncResult(val imported: Long, val skipped: Long, val deleted: Long)

/**
 * The health-data sync: reads what changed in the device's health store
 * since the last sync and posts it to /health-connect/sync, which imports it
 * like a device sync (server/services/healthConnectImport.ts). The read
 * position advances only once every chunk was accepted, so a failed sync is
 * retried from the same place and nothing is lost.
 *
 * [source] is null on a platform without one.
 */
public class HealthSync(
    private val api: ApiClient,
    private val source: HealthDataSource?,
    private val store: HealthSyncStore,
) {
    private val lock = Mutex()
    private val enabledUser = MutableStateFlow(store.enabledFor)

    /** The user the sync is on for on this device, or null. */
    public val enabledFor: StateFlow<String?> = enabledUser.asStateFlow()

    public suspend fun availability(): HealthAvailability = source?.availability() ?: HealthAvailability.Unsupported

    public suspend fun hasPermissions(): Boolean = source?.hasPermissions() == true

    /** Turns the sync on for [userId] (permissions granted) and runs the first one. */
    public suspend fun enable(userId: String): HealthSyncResult {
        check(source != null && source.hasPermissions()) { "Health Connect permissions aren't granted" }
        remember(userId)
        return checkNotNull(sync(userId)) { "Health Connect permissions were withdrawn" }
    }

    /** Turns the sync off and forgets the read position; imports made so far stay. */
    public fun disable() {
        store.enabledFor?.let { store.saveToken(it, null) }
        remember(null)
    }

    /**
     * Syncs for [userId] when the sync is on for them and the permissions are
     * still granted; returns null otherwise.
     *
     * @throws com.fitai.coach.core.api.ApiException when the server refuses a chunk.
     */
    public suspend fun sync(userId: String): HealthSyncResult? = lock.withLock {
        val reader = source ?: return@withLock null
        if (enabledUser.value != userId || !reader.hasPermissions()) return@withLock null
        val changes = reader.changesSince(store.token(userId))
        val result = upload(changes)
        store.saveToken(userId, changes.nextToken)
        result
    }

    private suspend fun upload(changes: HealthChanges): HealthSyncResult {
        var imported = 0L
        var skipped = 0L
        var deleted = 0L
        val sessionChunks = changes.sessions.chunked(MAX_SESSIONS_PER_REQUEST)
        val deletionChunks = changes.deletedIds.chunked(MAX_DELETIONS_PER_REQUEST)
        val requests = maxOf(sessionChunks.size, deletionChunks.size)
        for (index in 0 until requests) {
            val body = PostHealthConnectSyncRequest(
                sessions = sessionChunks.getOrElse(index) { emptyList() }.map { it.toRequest() },
                deletedIds = deletionChunks.getOrElse(index) { emptyList() },
            )
            val response = api.call(ApiEndpoints.PostHealthConnectSync, body)
            imported += response.imported
            skipped += response.skipped
            deleted += response.deleted
        }
        return HealthSyncResult(imported, skipped, deleted)
    }

    private fun remember(userId: String?) {
        store.enabledFor = userId
        enabledUser.value = userId
    }

    private companion object {
        // The server's limits (healthConnectSyncSchema).
        const val MAX_SESSIONS_PER_REQUEST = 100
        const val MAX_DELETIONS_PER_REQUEST = 500
    }
}

private fun HealthSession.toRequest() = PostHealthConnectSyncRequest.SessionsItem(
    id = id,
    startTime = startTime,
    endTime = endTime,
    zoneOffsetMinutes = zoneOffsetMinutes,
    sportType = sportType,
    title = title?.take(MAX_TITLE),
    distanceMeters = distanceMeters,
    activeCalories = activeCalories,
    avgHeartRate = avgHeartRate,
    maxHeartRate = maxHeartRate,
    dataOrigin = dataOrigin,
)

private const val MAX_TITLE = 200
