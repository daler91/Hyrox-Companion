package com.fitai.coach.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.GetGarminStatusResponse
import com.fitai.coach.core.api.generated.GetStravaStatusResponse
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.User
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.core.data.StravaConnectException
import com.fitai.coach.core.data.UserSession
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
    /** Which action is in flight ("strava-sync", "garmin-connect", "delete", …). */
    val busy: String? = null,
)

/** Settings, v1 scope: profile and units, AI coach, notifications, integrations, privacy, account. */
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class SettingsViewModel(
    private val session: UserSession,
    private val sessions: SessionManager,
    private val push: PushRegistration,
) : ViewModel() {
    private val local = MutableStateFlow(Local())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<SettingsUiState> = combine(
        session.account.user,
        session.preferences.preferences,
        combine(session.account.strava, session.account.garmin, ::Pair),
        combine(session.sync.pendingCount, push.enabledFor, ::Pair),
        local,
    ) { user, prefs, (strava, garmin), (pending, pushUser), l ->
        SettingsUiState(
            user = user,
            preferences = prefs,
            strava = strava,
            garmin = garmin,
            errorReporting = l.errorReporting,
            pendingWrites = pending,
            pushAvailable = push.available,
            pushOn = pushUser == session.userId,
            busy = l.busy,
        )
    }.stateIn(viewModelScope, SharingStarted.WhileSubscribed(STOP_TIMEOUT_MS), SettingsUiState())

    init {
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
        sessions.signOut()
    }

    /** Deletes the account on the server, then everything of it on the device. */
    fun deleteAccount() = run("delete", "Deletion failed") {
        session.account.deleteAccount()
        push.forget()
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

fun stravaImported(count: Long): String = "Imported $count new ${if (count == 1L) "activity" else "activities"} from Strava"

/** What signing out would throw away, for the confirmation. */
fun unsyncedWarning(pending: Int): String =
    "$pending ${if (pending == 1) "change hasn't" else "changes haven't"} reached the server yet. " +
        "Signing out deletes them from this device."
