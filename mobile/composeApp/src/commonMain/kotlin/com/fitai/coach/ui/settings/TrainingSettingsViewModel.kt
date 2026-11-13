package com.fitai.coach.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.data.UserSession
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.builtins.ListSerializer
import kotlin.time.Clock
import kotlin.time.Duration.Companion.days
import kotlin.time.Instant

data class TrainingSettingsState(
    val preferences: PreferencesResponse? = null,
    /** Which card is saving ("race", "body", "heart", "style"…), or null. */
    val saving: String? = null,
    /** The style switch just saved, said until the screen closes. */
    val transitionNotice: String? = null,
    /** Style changes made on this device, newest first. */
    val audit: List<StyleAuditEntry> = emptyList(),
    /** The MAF setup sheet; set while it is open. */
    val mafSetup: MafSetupSheet? = null,
)

/** The open MAF setup: its answers, the style switch it completes (null when only editing), and why it opened. */
data class MafSetupSheet(val setup: MafSetup, val switchFrom: String? = null, val blocked: String? = null, val error: String? = null)

/**
 * Settings → Training (the web's Training tab): race profile, body
 * composition, heart rate and power, meals per day, weekly goal, adherence
 * insights and the training style with its MAF setup. Choices save at once,
 * as the rest of Settings does; a card with typed numbers saves with its own
 * button, after the same range checks the server makes.
 */
@Suppress("TooGenericExceptionCaught")
class TrainingSettingsViewModel(private val session: UserSession, private val now: () -> Instant = { Clock.System.now() }) : ViewModel() {
    private val local = MutableStateFlow(TrainingSettingsState())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    private val auditFlow = session.cache.observe(AUDIT_KEY, ListSerializer(StyleAuditEntry.serializer())).map { it.orEmpty() }

    val state: StateFlow<TrainingSettingsState> = combine(local, session.preferences.preferences, auditFlow) { s, prefs, audit ->
        s.copy(preferences = prefs, audit = audit)
    }.stateIn(viewModelScope, SharingStarted.Eagerly, TrainingSettingsState())

    /** Saves a choice at once (meals per day, weekly goal, adherence insights). */
    fun choose(patch: UpdateUserPreferences) = save(null, patch, success = null)

    /** Saves a card's changes; the button is only enabled when they pass the range checks. */
    fun saveCard(card: String, patch: UpdateUserPreferences) = save(card, patch, success = "Settings saved")

    /**
     * Switches the coaching style, after the athlete confirmed it. MAF needs
     * an age and a category first: without them the setup opens, and saving
     * it completes the switch.
     */
    fun switchStyle(to: String) {
        val prefs = state.value.preferences ?: return
        val from = prefs.trainingStyleId ?: BALANCED_STYLE
        val setup = MafSetup.from(prefs)
        when {
            to == from -> Unit
            to == MAF_STYLE && setup.patch() == null -> local.update {
                it.copy(mafSetup = MafSetupSheet(setup, switchFrom = from, blocked = "Complete MAF setup to switch styles"))
            }
            else -> commitSwitch(from, to, setup.patch().takeIf { to == MAF_STYLE })
        }
    }

    /** Opens the MAF setup for an athlete already on MAF, to change the answers that set the ceiling. */
    fun editMafSetup() {
        val prefs = state.value.preferences ?: return
        local.update { it.copy(mafSetup = MafSetupSheet(MafSetup.from(prefs))) }
    }

    fun editMaf(change: (MafSetup) -> MafSetup) = local.update { s ->
        s.copy(mafSetup = s.mafSetup?.let { it.copy(setup = change(it.setup), error = null) })
    }

    /** Closing the setup ends the switch it was part of, so a later save never applies it. */
    fun closeMafSetup() = local.update { it.copy(mafSetup = null) }

    fun saveMafSetup() {
        val sheet = state.value.mafSetup ?: return
        val answers = sheet.setup.patch()
        if (answers == null) {
            local.update { s -> s.copy(mafSetup = sheet.copy(error = sheet.setup.error)) }
            return
        }
        val from = sheet.switchFrom
        if (from != null) {
            commitSwitch(from, MAF_STYLE, answers)
        } else {
            save("maf", answers, success = "MAF setup saved") { local.update { it.copy(mafSetup = null) } }
        }
    }

    private fun commitSwitch(from: String, to: String, mafAnswers: UpdateUserPreferences?) {
        val at = now()
        val patch = styleSwitchPatch(from, to, at.toString(), (at + 7.days).toString(), mafAnswers)
        save("style", patch, success = null) {
            local.update { it.copy(mafSetup = null, transitionNotice = transitionNotice(to)) }
            val entry = StyleAuditEntry(at.toString(), from, to, recalculationSummary(to))
            val serializer = ListSerializer(StyleAuditEntry.serializer())
            val earlier = session.cache.get(AUDIT_KEY, serializer).orEmpty()
            session.cache.put(AUDIT_KEY, serializer, (listOf(entry) + earlier).take(MAX_AUDIT_ENTRIES))
        }
    }

    private fun save(card: String?, patch: UpdateUserPreferences, success: String?, after: suspend () -> Unit = {}) {
        if (card != null && local.value.saving != null) return
        local.update { it.copy(saving = card) }
        viewModelScope.launch {
            try {
                session.preferences.update(patch)
                after()
                success?.let { toasts.send(it) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: ApiException) {
                toasts.send(rejection(e))
            } catch (e: Exception) {
                toasts.send(e.userMessage(SAVE_FAILED))
            }
            local.update { it.copy(saving = null) }
        }
    }

    /** The server's refusal in words (describePreferencesRejection): the MAF setup, a bad value, or why. */
    private fun rejection(e: ApiException): String = when (e.code) {
        "MAF_SETUP_REQUIRED" -> "Complete MAF setup: enter a valid age and select your category."
        "VALIDATION_ERROR" -> "One of your training settings has a value that can't be saved. Check it and try again."
        else -> e.userMessage(SAVE_FAILED)
    }

    private companion object {
        const val AUDIT_KEY = "settings:style-audit"
        const val SAVE_FAILED = "Couldn't save your settings"
    }
}
