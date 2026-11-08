package com.fitai.coach.health

import android.content.Context
import androidx.core.content.edit
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.health.HealthSync
import com.fitai.coach.core.health.HealthSyncScheduler
import com.fitai.coach.core.health.HealthSyncStore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withTimeoutOrNull
import org.koin.core.component.KoinComponent
import org.koin.core.component.get
import java.util.concurrent.TimeUnit

/**
 * One Health Connect sync in the background. The Clerk SDK supplies the
 * athlete's token outside the UI, so this needs no screen open; it signs in
 * nobody and does nothing when nobody is signed in.
 */
class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params), KoinComponent {
    @Suppress("TooGenericExceptionCaught")
    override suspend fun doWork(): Result {
        val session = withTimeoutOrNull(SESSION_WAIT_MS) { get<SessionManager>().session.filterNotNull().first() }
            ?: return Result.success()
        return try {
            val result = get<HealthSync>().sync(session.userId)
            if ((result?.imported ?: 0) > 0 || (result?.deleted ?: 0) > 0) runCatching { session.timeline.refresh() }
            Result.success()
        } catch (e: CancellationException) {
            throw e
        } catch (e: ApiException) {
            // A refusal (4xx) won't change on retry; the next run reads the same changes again.
            if (e.status >= SERVER_ERRORS || e.status == TOO_MANY_REQUESTS) Result.retry() else Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }

    private companion object {
        const val SESSION_WAIT_MS = 10_000L
        const val SERVER_ERRORS = 500
        const val TOO_MANY_REQUESTS = 429
    }
}

/** Health Connect syncs every few hours while the sync is on, and once when the app opens. */
internal class WorkManagerHealthScheduler(private val context: Context) : HealthSyncScheduler {
    private val work get() = WorkManager.getInstance(context)
    private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    override fun schedule() {
        val periodic = PeriodicWorkRequestBuilder<HealthSyncWorker>(SYNC_EVERY_HOURS, TimeUnit.HOURS).setConstraints(online).build()
        work.enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, periodic)
    }

    override fun cancel() {
        work.cancelUniqueWork(PERIODIC)
        work.cancelUniqueWork(NOW)
    }

    override fun syncNow() {
        work.enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, OneTimeWorkRequestBuilder<HealthSyncWorker>().setConstraints(online).build())
    }

    private companion object {
        const val PERIODIC = "health-connect-sync"
        const val NOW = "health-connect-sync-now"
        const val SYNC_EVERY_HOURS = 4L
    }
}

/** Who turned the sync on, and each user's Changes API token, in the app's private preferences. */
internal class SharedPreferencesHealthSyncStore(context: Context) : HealthSyncStore {
    private val prefs = context.getSharedPreferences("health_connect", Context.MODE_PRIVATE)

    override var enabledFor: String?
        get() = prefs.getString(ENABLED_FOR, null)
        set(value) = prefs.edit { if (value == null) remove(ENABLED_FOR) else putString(ENABLED_FOR, value) }

    override fun token(userId: String): String? = prefs.getString(TOKEN + userId, null)

    override fun saveToken(userId: String, token: String?) =
        prefs.edit { if (token == null) remove(TOKEN + userId) else putString(TOKEN + userId, token) }

    private companion object {
        const val ENABLED_FOR = "enabled_for"
        const val TOKEN = "changes_token_"
    }
}
