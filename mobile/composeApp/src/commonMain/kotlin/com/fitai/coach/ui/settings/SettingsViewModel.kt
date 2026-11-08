package com.fitai.coach.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetGarminStatusResponse
import com.fitai.coach.core.api.generated.GetStravaStatusResponse
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.data.ExportFormat
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.data.StravaConnectException
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.core.health.HealthAvailability
import com.fitai.coach.core.health.HealthSync
import com.fitai.coach.core.health.HealthSyncScheduler
import com.fitai.coach.core.push.PushRegistration
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class SettingsUiState(
    val user: User? = null,
    val preferences: PreferencesResponse? = null,
    val strava: GetStravaStatusResponse? = null,
    val garmin: GetGarminStatusResponse? = null,
    val errorReporting: Boolean? = null,
    val pendingWrites: Int = 0,
    /** Whether this build can receive push notifications. */
    val pushAvailable: Boolean = false,
    /** Whether push is on on this phone, for this athlete. */
    val pushOn: Boolean = false,
    val health: HealthState = HealthState(),
    /** Which action is in flight ("strava-sync", "garmin-connect", "delete", …). */
    val busy: String? = null,
)

/** Settings, v1 scope: profile and units, AI coach, notifications, integrations, privacy, account. */
/** The Health Connect card: what the phone offers, and whether the sync is on for this athlete. */
data class HealthState(
    val availability: HealthAvailability = HealthAvailability.Unsupported,
    val on: Boolean = false,
    /** On, but the athlete withdrew access in Health Connect since. */
    val accessWithdrawn: Boolean = false,
)

@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class SettingsViewModel(
    private val session: UserSession,
    private val sessions: SessionManager,
    private val push: PushRegistration,
    private val health: HealthSync? = null,
    private val healthScheduler: HealthSyncScheduler? = null,
) : ViewModel() {
    private val local = MutableStateFlow(Local())
    private val healthAccess = MutableStateFlow(HealthAvailability.Unsupported to true)
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<SettingsUiState> = combine(
        session.account.user,
        session.preferences.preferences,
        combine(session.account.strava, session.account.garmin, ::Pair),
        combine(session.sync.pendingCount, push.enabledFor, health?.enabledFor ?: MutableStateFlow(null), healthAccess, ::Devices),
        local,
    ) { user, prefs, (strava, garmin), devices, l ->
        val (pending, pushUser) = devices.pendingWrites to devices.pushUser
        val (healthUser, access) = devices.healthUser to devices.healthAccess
        SettingsUiState(
            user = user,
            preferences = prefs,
            strava = strava,
            garmin = garmin,
            errorReporting = l.errorReporting,
            pendingWrites = pending,
            pushAvailable = push.available,
            pushOn = pushUser == session.userId,
            health = HealthState(
                availability = access.first,
                on = healthUser == session.userId,
                accessWithdrawn = healthUser == session.userId && !access.second,
            ),
            busy = l.busy,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), SettingsUiState())

    init {
        refreshHealth()
        viewModelScope.launch { runCatching { session.account.refreshUser() } }
        viewModelScope.launch { runCatching { session.account.refreshIntegrations() } }
        viewModelScope.launch { runCatching { session.preferences.refresh() } }
        viewModelScope.launch {
            // On until the athlete says otherwise, as on the web. Unreadable
            // (offline) leaves the switch disabled rather than guessing.
            runCatching { session.account.errorReporting() }
                .onSuccess { choice -> local.update { it.copy(errorReporting = choice ?: true) } }
        }
    }

    /** Saves one preference change at once. */
    fun update(patch: UpdateUserPreferences) = run(null, "Couldn't save that setting") { session.preferences.update(patch) }

    fun setErrorReporting(granted: Boolean) {
        local.update { it.copy(errorReporting = granted) }
        viewModelScope.launch {
            try {
                session.account.setErrorReporting(granted)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                local.update { it.copy(errorReporting = !granted) }
                toasts.send(e.userMessage("Couldn't save that setting"))
            }
        }
    }

    fun syncStrava() = run("strava-sync", "Couldn't sync Strava") {
        val result = session.account.syncStrava()
        toasts.send(stravaImported(result.imported))
        runCatching { session.timeline.refresh() }
    }

    /** Opens Strava's consent page; Strava's App Link brings the athlete back to [finishStrava]. */
    fun connectStrava(open: (String) -> Unit) = run("strava-connect", "Couldn't start connecting Strava") {
        open(session.account.startStravaConnect())
    }

    /** Finishes the connection Strava sent back. */
    fun finishStrava(code: String?, state: String?, error: String?) = run("strava-connect", "Couldn't connect Strava") {
        try {
            session.account.finishStravaConnect(code, state, error)
            toasts.send("Strava connected. Importing your recent activities…")
        } catch (e: StravaConnectException) {
            toasts.send(e.message ?: "Strava wasn't connected.")
        }
    }

    fun disconnectStrava() = run("strava-disconnect", "Couldn't disconnect Strava") {
        session.account.disconnectStrava()
        toasts.send("Strava disconnected")
    }

    fun connectGarmin(email: String, password: String, onDone: () -> Unit) = run("garmin-connect", "Couldn't connect Garmin") {
        session.account.connectGarmin(email, password)
        toasts.send("Garmin connected")
        onDone()
    }

    fun syncGarmin() = run("garmin-sync", "Couldn't sync Garmin") {
        val result = session.account.syncGarmin()
        toasts.send("Imported ${result.imported} new activities. ${result.skipped} already existed.")
        runCatching { session.timeline.refresh() }
    }

    fun disconnectGarmin() = run("garmin-disconnect", "Couldn't disconnect Garmin") {
        session.account.disconnectGarmin()
        toasts.send("Garmin disconnected")
    }

    /** Fetches the athlete's data export and hands it to [share]. */
    fun export(format: ExportFormat, share: (fileName: String, mimeType: String, content: String) -> Unit) =
        run("export", "Couldn't export your data") {
            val content = session.account.exportData(format)
            share(format.fileName, format.mimeType, content)
        }

    /** Re-reads what Health Connect offers and whether access still holds (e.g. back from its settings). */
    fun refreshHealth() {
        val sync = health ?: return
        viewModelScope.launch {
            runCatching { sync.availability() to sync.hasPermissions() }.onSuccess { healthAccess.value = it }
        }
    }

    /** Access granted: turns the sync on, runs the first one and schedules the rest. */
    fun enableHealth() = run("health", "Couldn't sync Health Connect") {
        val sync = health ?: return@run
        try {
            val result = sync.enable(session.userId)
            healthScheduler?.schedule()
            toasts.send("Health Connect connected. ${healthImported(result.imported)}")
            runCatching { session.timeline.refresh() }
        } finally {
            refreshHealth()
        }
    }

    fun syncHealth() = run("health", "Couldn't sync Health Connect") {
        val result = health?.sync(session.userId) ?: return@run
        toasts.send(healthImported(result.imported))
        if (result.imported > 0 || result.deleted > 0) runCatching { session.timeline.refresh() }
    }

    fun disconnectHealth() = run("health", "Couldn't disconnect Health Connect") {
        stopHealth()
        toasts.send("Health Connect disconnected. Workouts already imported stay.")
        refreshHealth()
    }

    fun healthAccessDenied() {
        viewModelScope.launch { toasts.send("Health Connect access wasn't granted. fitai needs it to import your workouts.") }
    }

    private suspend fun stopHealth() {
        healthScheduler?.cancel()
        health?.disable()
    }

    /** Registers this phone for push, once the system allows notifications. */
    fun enablePush() = run("push", "Couldn't turn on notifications") {
        push.enable(session.userId)
        toasts.send("Notifications are on for this phone")
    }

    fun disablePush() = run("push", "Couldn't turn off notifications") { push.disable() }

    /** The system refused the permission: only its settings can grant it now. */
    fun notificationsBlocked() {
        viewModelScope.launch { toasts.send("Notifications are blocked for fitai. Allow them in your phone's settings.") }
    }

    /** Signs out and deletes this user's data from the device, unsent changes included. Push stops first. */
    fun signOut() = run("sign-out", "Couldn't sign out. Check your connection and try again.") {
        push.disable()
        stopHealth()
        sessions.signOut()
    }

    /** Deletes the account on the server, then everything of it on the device. */
    fun deleteAccount() = run("delete", "Deletion failed") {
        session.account.deleteAccount()
        push.forget()
        stopHealth()
        sessions.forgetDeletedAccount()
    }

    private fun run(busy: String?, failure: String, block: suspend () -> Unit) {
        if (busy != null && local.value.busy != null) return
        local.update { it.copy(busy = busy) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            }
            local.update { it.copy(busy = null) }
        }
    }

    private data class Local(val errorReporting: Boolean? = null, val busy: String? = null)

    private companion object {
        const val STOP_TIMEOUT_MS = 5_000L
    }
}

/** The word the athlete types to confirm deleting their account (AccountDangerZone.tsx). */
const val DELETE_CONFIRMATION = "DELETE"

/** "07:00": the hour of the day emails go out. */
fun hourLabel(hour: Int): String = "${hour.toString().padStart(2, '0')}:00"

fun healthImported(count: Long): String =
    if (count == 0L) "No new workouts to import." else "Imported $count new ${if (count == 1L) "workout" else "workouts"}."

/** This phone's side of Settings, read together: unsent writes, push, Health Connect. */
private data class Devices(
    val pendingWrites: Int,
    val pushUser: String?,
    val healthUser: String?,
    val healthAccess: Pair<HealthAvailability, Boolean>,
)

fun stravaImported(count: Long): String = "Imported $count new ${if (count == 1L) "activity" else "activities"} from Strava"

/** What signing out would throw away, for the confirmation. */
fun unsyncedWarning(pending: Int): String =
    "$pending ${if (pending == 1) "change hasn't" else "changes haven't"} reached the server yet. " +
        "Signing out deletes them from this device."
