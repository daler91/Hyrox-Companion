package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.filterIsInstance
import kotlinx.coroutines.launch

/**
 * Everything that belongs to one signed-in user: their database, outbox and
 * repositories. [SessionManager] opens one at sign-in and closes it when the
 * user goes.
 */
public class UserSession internal constructor(
    public val userId: String,
    public val database: FitaiDatabase,
    api: ApiClient,
    now: () -> Long,
    newKey: () -> String,
) {
    public val sync: SyncEngine = SyncEngine(database, api, now, newKey)
    public val timeline: TimelineRepository = TimelineRepository(database, api)
    public val workouts: WorkoutRepository = WorkoutRepository(database, api, sync)

    private var job: Job? = null

    /** Sends queued writes, then refreshes the timeline. */
    public suspend fun refresh() {
        sync.sync()
        timeline.refresh()
    }

    internal fun start(scope: CoroutineScope, online: Flow<Boolean>) {
        job = scope.launch {
            sync.start(this, online)
            launch { sync.events.filterIsInstance<SyncEvent.Synced>().collect { refreshTimeline() } }
            refreshTimeline()
        }
    }

    internal suspend fun close() {
        job?.cancelAndJoin()
        database.close()
    }

    // A refresh is best effort: offline, the screens keep showing the cache.
    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    private suspend fun refreshTimeline() {
        try {
            timeline.refresh()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Deliberately ignored; see above.
        }
    }
}
