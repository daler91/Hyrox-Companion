package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.dates.deviceTimeZone
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.launch

/**
 * Everything that belongs to one signed-in user: their database, outbox and
 * repositories. [SessionManager] opens one at sign-in and closes it when the
 * user goes.
 */
public class UserSession internal constructor(
    public val userId: String,
    public val database: FitaiDatabase,
    /** For the calls a screen makes online only (analytics, AI parsing); cached data goes through the repositories. */
    public val api: ApiClient,
    now: () -> Long,
    newKey: () -> String,
) {
    public val sync: SyncEngine = SyncEngine(database, api, now, newKey)
    public val cache: CacheStore = CacheStore(database, now)
    public val timeline: TimelineRepository = TimelineRepository(database, api, sync, cache)
    public val workouts: WorkoutRepository = WorkoutRepository(database, api, sync, newKey)
    public val planDays: PlanDayRepository = PlanDayRepository(api)
    public val plans: PlanTools = PlanTools(api, timeline)
    public val annotations: AnnotationRepository = AnnotationRepository(api, cache)
    public val reviews: ReviewRepository = ReviewRepository(api, cache)
    public val preferences: PreferencesRepository = PreferencesRepository(api, cache)
    public val parser: WorkoutParser = WorkoutParser(api)
    public val coach: CoachRepository = CoachRepository(api)
    public val nutrition: NutritionRepository = NutritionRepository(api, cache)
    public val analytics: AnalyticsRepository = AnalyticsRepository(api, cache)
    public val account: AccountRepository = AccountRepository(api, cache)
    public val athleteCard: AthleteCardRepository = AthleteCardRepository(api, cache)
    public val recycleBin: RecycleBinRepository = RecycleBinRepository(api, cache)
    public val onboarding: OnboardingRepository = OnboardingRepository(api, cache, preferences, timeline)

    private var job: Job? = null
    private var scope: CoroutineScope? = null

    /** Sends queued writes, then refreshes the timeline. */
    public suspend fun refresh() {
        sync.sync()
        timeline.refresh()
    }

    /**
     * Saves the phone's timezone as the athlete's when it changed, as the web
     * does once a visit. Runs at session start and whenever the app comes back
     * to the foreground. @throws com.fitai.coach.core.api.ApiException
     */
    public suspend fun syncTimezone(): Boolean = preferences.syncTimezone(deviceTimeZone())

    /**
     * The app came back to the foreground, perhaps after a flight: checks the
     * timezone again. Part of the session's own work, so closing the session
     * waits for it rather than closing the database under it.
     */
    public fun resumed() {
        val running = job ?: return
        scope?.launch(running) { bestEffort { syncTimezone() } }
    }

    internal fun start(scope: CoroutineScope, online: Flow<Boolean>) {
        this.scope = scope
        job = scope.launch {
            sync.start(this, online)
            // After writes went (or were dropped), the timeline shows the server's version.
            launch { sync.events.collect { bestEffort { timeline.refresh() } } }
            bestEffort { preferences.refresh() }
            bestEffort { syncTimezone() }
            bestEffort { timeline.refresh() }
            bestEffort { timeline.refreshPlans() }
        }
    }

    internal suspend fun close() {
        job?.cancelAndJoin()
        database.close()
    }

    // A refresh is best effort: offline, the screens keep showing the cache.
    @Suppress("TooGenericExceptionCaught", "SwallowedException")
    private suspend fun bestEffort(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // Deliberately ignored; see above.
        }
    }
}
