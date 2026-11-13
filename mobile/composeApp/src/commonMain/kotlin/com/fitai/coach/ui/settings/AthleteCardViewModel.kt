package com.fitai.coach.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.AthleteFact
import com.fitai.coach.core.api.generated.PatchAthleteFactsByIdRequest
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
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class AthleteCardState(
    /** Every fact, retired ones included; null until the card has been fetched once. */
    val facts: List<AthleteFact>? = null,
    /** The card couldn't be fetched and none is cached. */
    val loadFailed: Boolean = false,
    /** The athlete's today (YYYY-MM-DD), which decides what is due for a "Still true?". */
    val today: String = "",
    /** The older free-text injuries note, while the athlete still has one. */
    val legacyNote: String? = null,
    /** A change is being saved; every other change waits. */
    val busy: Boolean = false,
    val newFact: String = "",
    val newCategory: AthleteFact.Category = AthleteFact.Category.Constraint,
    /** The fact being reworded, if any. */
    val editing: FactEdit? = null,
    /** The step waiting for the athlete to confirm, if any. */
    val confirm: AthleteCardConfirm? = null,
) {
    val card: AthleteCardFacts? get() = facts?.let { groupAthleteFacts(it, today) }
}

/**
 * Settings → Athlete card (the web's AthleteCardSection): what the coach
 * should always program around, a fact at a time. Facts are added, reworded,
 * retired (kept listed, no longer read), restored and deleted; one past its
 * review date asks "Still true?" and stays in use until answered. The older
 * free-text note can be moved onto the card or removed.
 */
@Suppress("TooGenericExceptionCaught")
class AthleteCardViewModel(private val session: UserSession, private val todayIn: (String?) -> String) : ViewModel() {
    private val local = MutableStateFlow(AthleteCardState())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<AthleteCardState> = combine(
        local,
        session.athleteCard.facts,
        session.preferences.preferences,
        session.account.user,
    ) { s, facts, prefs, user ->
        s.copy(
            facts = facts,
            today = todayIn(prefs?.userTimezone),
            legacyNote = user?.trainingConstraints?.trim()?.takeIf { it.isNotEmpty() },
        )
    }.stateIn(viewModelScope, SharingStarted.Eagerly, AthleteCardState())

    init {
        refresh()
    }

    /** Fetches the card; offline, the cached one stays, and with none the card offers to try again. */
    fun refresh() {
        local.update { it.copy(loadFailed = false) }
        viewModelScope.launch {
            try {
                session.athleteCard.refresh()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                local.update { it.copy(loadFailed = true) }
            }
        }
    }

    fun editNew(text: String) = local.update { it.copy(newFact = text.take(ATHLETE_FACT_MAX_LENGTH)) }

    fun chooseNewCategory(category: AthleteFact.Category) = local.update { it.copy(newCategory = category) }

    fun add() {
        val s = state.value
        val text = s.newFact.trim()
        if (text.isEmpty() || s.card?.atCap == true) return
        run("Couldn't add that fact") {
            session.athleteCard.add(text, postCategory(s.newCategory))
            local.update { it.copy(newFact = "") }
            toasts.send("Saved to your athlete card")
        }
    }

    fun startEdit(fact: AthleteFact) = local.update { it.copy(editing = FactEdit.of(fact)) }

    fun edit(change: (FactEdit) -> FactEdit) = local.update { s -> s.copy(editing = s.editing?.let(change)) }

    fun cancelEdit() = local.update { it.copy(editing = null) }

    /** Saves the new words and category; with nothing changed it just closes the editor. */
    fun saveEdit() {
        val s = state.value
        val edit = s.editing ?: return
        val fact = s.facts?.firstOrNull { it.id == edit.id }
        val changes = fact?.let { edit.changes(it) }
        when {
            edit.text.isBlank() -> Unit
            fact == null || changes == null -> cancelEdit()
            else -> change(fact, changes) { local.update { it.copy(editing = null) } }
        }
    }

    /** "Yes, still true": the fact is asked about again in 90 days. */
    fun stillTrue(fact: AthleteFact) = change(fact, PatchAthleteFactsByIdRequest(confirm = true))

    /** "No, retire it": no confirm step, as on the web, since the question was just asked. */
    fun retire(fact: AthleteFact) = change(fact, PatchAthleteFactsByIdRequest(active = false))

    fun restore(fact: AthleteFact) = change(fact, PatchAthleteFactsByIdRequest(active = true))

    fun ask(step: AthleteCardConfirm) = local.update { it.copy(confirm = step) }

    fun dismissConfirm() = local.update { it.copy(confirm = null) }

    /** Does the step the athlete just confirmed. */
    fun confirm() {
        val step = state.value.confirm ?: return
        dismissConfirm()
        when (step) {
            is AthleteCardConfirm.Retire -> retire(step.fact)
            is AthleteCardConfirm.Delete -> run("Couldn't delete that fact") {
                session.athleteCard.delete(step.fact.id)
                toasts.send("Fact deleted")
            }
            AthleteCardConfirm.RemoveNote -> run("Couldn't remove the note") {
                session.preferences.update(UpdateUserPreferences(trainingConstraints = Patch.clear()))
                toasts.send("Note removed")
                quietly { session.account.refreshUser() }
            }
        }
    }

    /** Moves the older note onto the card, a fact per sentence; the note goes only once all of it fits. */
    fun importNote() = run("Couldn't add your note to the card") {
        val result = session.athleteCard.importNote()
        toasts.send(importedNoteMessage(result.added, result.skipped))
        quietly { session.athleteCard.refresh() }
        quietly { session.account.refreshUser() }
    }

    private fun change(fact: AthleteFact, changes: PatchAthleteFactsByIdRequest, after: () -> Unit = {}) =
        run("Couldn't update that fact") {
            session.athleteCard.update(fact.id, changes)
            after()
            toasts.send(updatedFactMessage(changes))
        }

    /** A refetch after a change that already went through: failing, it leaves the cached copy. */
    @Suppress("SwallowedException")
    private suspend fun quietly(block: suspend () -> Unit) {
        try {
            block()
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            // The change was saved; the next refresh catches the screen up.
        }
    }

    /** One change at a time; a refusal is said in the server's words where it gave some. */
    private fun run(failure: String, block: suspend () -> Unit) {
        if (local.value.busy) return
        local.update { it.copy(busy = true) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage(failure))
            }
            local.update { it.copy(busy = false) }
        }
    }
}
