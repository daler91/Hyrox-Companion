package com.fitai.coach.ui.coach

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.fitai.coach.core.api.generated.ChatFactProposal
import com.fitai.coach.core.api.generated.PlanProposal
import com.fitai.coach.core.data.CoachRepository
import com.fitai.coach.core.data.EncodedImage
import com.fitai.coach.core.data.MAX_CHAT_MESSAGE
import com.fitai.coach.core.data.MAX_CHAT_PHOTO_CHARS
import com.fitai.coach.ui.format.userMessage
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
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

data class QuickAction(val label: String, val message: String)

data class CoachUiState(
    val items: List<ChatItem> = listOf(welcomeItem()),
    val quickActions: List<QuickAction> = emptyList(),
    val loadingHistory: Boolean = true,
    val canLoadOlder: Boolean = false,
    val loadingOlder: Boolean = false,
    val olderFailed: Boolean = false,
    /** "Thinking..." and friends while a reply is coming; null otherwise. */
    val progress: String? = null,
    val sending: Boolean = false,
    val photo: EncodedImage? = null,
    /** Null until the athlete's preferences load; false shows the consent card. */
    val aiEnabled: Boolean? = null,
    val enablingAi: Boolean = false,
    /** A proposal action (apply / dismiss / undo) is in flight for this proposal id. */
    val busyProposal: String? = null,
)

/**
 * The coach panel: the conversation, streamed replies and plan-change
 * proposals, as CoachPanel does on the web.
 */
// One function per control the panel offers (send, stop, retry, rate, apply…).
@Suppress("TooGenericExceptionCaught", "TooManyFunctions")
class CoachViewModel(
    private val coach: CoachRepository,
    aiEnabled: Flow<Boolean?>,
    private val enableAi: suspend () -> Unit,
    /** After the plan changed (a proposal applied or undone): refresh the timeline. */
    private val onPlanChanged: suspend () -> Unit,
    private val newId: () -> String,
) : ViewModel() {
    private val local = MutableStateFlow(CoachUiState())
    private val toasts = Channel<String>(Channel.BUFFERED)
    val messages: Flow<String> = toasts.receiveAsFlow()

    val state: StateFlow<CoachUiState> = combine(local, aiEnabled) { s, enabled -> s.copy(aiEnabled = enabled ?: false) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, CoachUiState())

    private var sendJob: Job? = null
    private var older: Pair<String, String>? = null

    /** What each sent message carried, so a failed reply can be retried as it was. */
    private val sent = mutableMapOf<String, Pair<String, EncodedImage?>>()

    init {
        load()
    }

    private fun load() {
        viewModelScope.launch {
            val greeting = try {
                coach.welcome().also { welcome ->
                    local.update { s ->
                        s.copy(
                            quickActions = welcome.quickActions.take(MAX_QUICK_ACTIONS).map {
                                QuickAction(
                                    it.label,
                                    it.message ?: it.label,
                                )
                            },
                        )
                    }
                }.greeting
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                DEFAULT_WELCOME
            }
            try {
                val page = coach.history()
                older = page.before?.let { b -> page.beforeId?.let { b to it } }
                val pending = runCatching { coach.pendingProposal() }.getOrNull()
                local.update { s ->
                    val history = page.messages.map { it.toItem() }
                    val shown = history.mapNotNull { it.proposal?.id }.toSet()
                    val trailing = pending?.takeIf { it.id !in shown }?.let { proposalItem(it) }
                    s.copy(
                        items = listOf(welcomeItem(greeting)) + history + listOfNotNull(trailing) + s.items.drop(1),
                        loadingHistory = false,
                        canLoadOlder = older != null,
                    )
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                local.update { s -> s.copy(items = listOf(welcomeItem(greeting)) + s.items.drop(1), loadingHistory = false) }
            }
        }
    }

    fun loadOlder() {
        val (before, beforeId) = older ?: return
        local.update { it.copy(loadingOlder = true, olderFailed = false) }
        viewModelScope.launch {
            try {
                val page = coach.history(before, beforeId)
                older = page.before?.let { b -> page.beforeId?.let { b to it } }
                local.update { s ->
                    val known = s.items.map { it.id }.toSet()
                    val earlier = page.messages.map { it.toItem() }.filter { it.id !in known }
                    s.copy(items = s.items.take(1) + earlier + s.items.drop(1), loadingOlder = false, canLoadOlder = older != null)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                local.update { it.copy(loadingOlder = false, olderFailed = true) }
            }
        }
    }

    fun attachPhoto(photo: EncodedImage) {
        if (photo.base64.length > MAX_CHAT_PHOTO_CHARS) {
            toasts.trySend("Photo too large. Try a smaller photo or a screenshot.")
            return
        }
        local.update { it.copy(photo = photo) }
    }

    fun removePhoto() = local.update { it.copy(photo = null) }

    /** Sends [text] (or the photo-only prompt). Returns false when nothing was sent, so the input keeps its text. */
    fun send(text: String): Boolean {
        val photo = local.value.photo
        val message = text.trim().ifEmpty { if (photo != null) PHOTO_ONLY_PROMPT else "" }
        val sendable = message.isNotEmpty() && !local.value.sending && message.length <= MAX_CHAT_MESSAGE
        if (sendable) {
            val userId = newId()
            sent[userId] = message to photo
            local.update { it.copy(photo = null) }
            stream(userId, message, photo, replaceAssistantId = null)
        }
        return sendable
    }

    /** Sends a quick action's message as an ordinary message. */
    fun quickAction(action: QuickAction) {
        send(action.message)
    }

    /** Stops the reply being streamed; the server keeps what was said so far. */
    fun stop() {
        val job = sendJob ?: return
        job.cancel()
        local.update { s ->
            s.copy(
                sending = false,
                progress = null,
                items = s.items.map {
                    if (it.streaming) it.copy(streaming = false, failure = ChatFailure("Stopped.", retryable = false)) else it
                },
            )
        }
    }

    /** Resends a failed reply's message in place: same user message, the failed reply replaced. */
    fun retry(assistantId: String) {
        val items = local.value.items
        val index = items.indexOfFirst { it.id == assistantId }
        val user = items.getOrNull(index - 1)?.takeIf { it.role == ChatRole.User } ?: return
        val (message, photo) = sent[user.id] ?: (user.content to null)
        if (local.value.sending) return
        local.update { s -> s.copy(items = s.items.filterNot { it.id == assistantId || it.id == user.id }) }
        stream(user.id, message, photo, replaceAssistantId = assistantId)
    }

    private fun stream(userId: String, message: String, photo: EncodedImage?, replaceAssistantId: String?) {
        val assistantId = newId()
        local.update { s ->
            s.copy(
                sending = true,
                progress = "Reading your training log...",
                items = s.items + ChatItem(userId, ChatRole.User, message, photoNote = photo?.let { "Photo attached" }) +
                    ChatItem(assistantId, ChatRole.Assistant, "", streaming = true),
            )
        }
        sendJob = viewModelScope.launch {
            try {
                coach.send(message, userId, assistantId, photo, replaceAssistantId).collect { event ->
                    local.update { s ->
                        val label = when {
                            event.status != null -> statusLabel(event.status)
                            event.text != null -> null
                            else -> s.progress
                        }
                        s.copy(progress = label, items = s.items.map { if (it.id == assistantId) it.apply(event) else it })
                    }
                }
                finish(assistantId, failure = null)
                if (local.value.items.firstOrNull { it.id == assistantId }?.proposal?.status == PlanProposal.Status.Applied) {
                    planChanged()
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                finish(assistantId, chatFailure(e))
            }
        }
    }

    private fun finish(assistantId: String, failure: ChatFailure?) {
        local.update { s ->
            s.copy(
                sending = false,
                progress = null,
                items = s.items.map { item ->
                    if (item.id != assistantId) {
                        item
                    } else {
                        val failed = failure ?: item.failure
                        item.copy(streaming = false, failure = failed, rateable = failed == null && item.content.isNotBlank())
                    }
                },
            )
        }
    }

    fun rate(item: ChatItem, up: Boolean) {
        val next = if (item.feedbackUp == up) null else up
        updateItem(item.id) { it.copy(feedbackUp = next) }
        viewModelScope.launch {
            try {
                coach.rate(item.id, next)
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                updateItem(item.id) { it.copy(feedbackUp = item.feedbackUp) }
                toasts.send("Couldn't save your rating")
            }
        }
    }

    fun decideFact(item: ChatItem, save: Boolean) {
        val fact = item.fact ?: return
        val status = if (save) ChatFactProposal.Status.Saved else ChatFactProposal.Status.Dismissed
        updateItem(item.id) { it.copy(fact = fact.copy(status = status)) }
        viewModelScope.launch {
            try {
                coach.decideFact(item.id, save)
                if (save) toasts.send("Saved to your athlete card")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                updateItem(item.id) { it.copy(fact = fact) }
                toasts.send(e.userMessage("Couldn't save that"))
            }
        }
    }

    fun applyProposal(proposal: PlanProposal, planDayIds: List<String>?) = proposalAction(proposal) {
        val result = coach.applyProposal(proposal.id, planDayIds?.takeIf { it.size < proposal.changes.size })
        if (result.applied) {
            val count = result.changeCount?.toInt() ?: planDayIds?.size ?: proposal.changes.size
            val total = proposal.changes.size
            val note = if (count >= total) {
                "Done — I've updated $count ${if (count == 1) "day" else "days"} in your plan."
            } else {
                "Done — I've applied $count of the $total changes to your plan."
            }
            say(note, save = true)
            planChanged()
        } else {
            say(result.message ?: "I couldn't apply that change just now.", save = false)
        }
    }

    fun dismissProposal(proposal: PlanProposal) = proposalAction(proposal) { coach.dismissProposal(proposal.id) }

    fun undoProposal(proposal: PlanProposal) = proposalAction(proposal) {
        val result = coach.undoProposal(proposal.id)
        val n = result.restoredCount
        val kept = result.keptDays.takeIf { it.isNotEmpty() }?.joinToString { it.dayLabel }
        val note = "Undone — I've put $n ${if (n == 1L) "day" else "days"} back the way they were." +
            (kept?.let { " I left what's changed since on $it as it is." } ?: "")
        say(note, save = true)
        planChanged()
    }

    fun enableAiCoach() {
        local.update { it.copy(enablingAi = true) }
        viewModelScope.launch {
            try {
                enableAi()
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                toasts.send("Could not enable AI Coach")
            }
            local.update { it.copy(enablingAi = false) }
        }
    }

    fun clearHistory() {
        viewModelScope.launch {
            try {
                coach.clearHistory()
                local.update { s -> s.copy(items = s.items.take(1)) }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                toasts.send(e.userMessage("Couldn't clear the conversation"))
            }
        }
    }

    private fun proposalAction(proposal: PlanProposal, block: suspend () -> Unit) {
        if (local.value.busyProposal != null) return
        local.update { it.copy(busyProposal = proposal.id) }
        viewModelScope.launch {
            try {
                block()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                say(e.userMessage("That plan change couldn't be applied. It may be out of date."), save = false)
            }
            // Whatever happened, show the proposal's status as the server has it now.
            runCatching { coach.proposal(proposal.id) }.getOrNull()?.let { fresh ->
                local.update { s -> s.copy(items = s.items.map { if (it.proposal?.id == fresh.id) it.copy(proposal = fresh) else it }) }
            }
            local.update { it.copy(busyProposal = null) }
        }
    }

    private suspend fun say(text: String, save: Boolean) {
        local.update { s -> s.copy(items = s.items + ChatItem(newId(), ChatRole.Assistant, text)) }
        if (save) runCatching { coach.saveAssistantMessage(text) }
    }

    private suspend fun planChanged() {
        runCatching { onPlanChanged() }
    }

    private fun updateItem(id: String, change: (ChatItem) -> ChatItem) =
        local.update { s -> s.copy(items = s.items.map { if (it.id == id) change(it) else it }) }

    private fun proposalItem(proposal: PlanProposal) =
        ChatItem("proposal-${proposal.id}", ChatRole.Assistant, proposal.summaryMessage, ChatKind.Proposal, proposal = proposal)

    private companion object {
        const val MAX_QUICK_ACTIONS = 4
    }
}
