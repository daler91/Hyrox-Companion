package com.fitai.coach.ui.coach

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.ChatFactProposal
import com.fitai.coach.core.api.generated.ChatHistoryMessage
import com.fitai.coach.core.api.generated.ChatRagInfo
import com.fitai.coach.core.api.generated.ChatSafetyNotice
import com.fitai.coach.core.api.generated.ChatStreamEvent
import com.fitai.coach.core.api.generated.PlanProposal

enum class ChatRole { User, Assistant }

/** What a row of the conversation is. */
enum class ChatKind { Text, Proposal, Summary }

/** A reply that failed: what to say, and whether "Try again" is offered. */
data class ChatFailure(val message: String, val retryable: Boolean)

/** One bubble of the conversation. */
data class ChatItem(
    val id: String,
    val role: ChatRole,
    val content: String,
    val kind: ChatKind = ChatKind.Text,
    val proposal: PlanProposal? = null,
    val fact: ChatFactProposal? = null,
    /** "Photo attached", or what the coach read from it (history). */
    val photoNote: String? = null,
    val feedbackUp: Boolean? = null,
    val rateable: Boolean = false,
    val streaming: Boolean = false,
    val failure: ChatFailure? = null,
    val safety: ChatSafetyNotice? = null,
    /** The reply drew on the athlete's coaching notes. */
    val fromNotes: Boolean = false,
)

const val WELCOME_ID = "welcome"
const val DEFAULT_WELCOME = "Hi! I'm your coach. Ask me about today's session, your plan or your recovery."

/** The greeting in a workout's own thread. */
const val THREAD_WELCOME = "Ask me anything about this workout: how it went, what it was for, or how to change it."
const val PHOTO_ONLY_PROMPT = "What do you make of this photo?"
const val GENERIC_FAILURE = "Something went wrong on our side. Please try again."

fun welcomeItem(greeting: String = DEFAULT_WELCOME) = ChatItem(id = WELCOME_ID, role = ChatRole.Assistant, content = greeting)

/** A saved row as a bubble (client/src/hooks/chat/chatSessionModel.ts). */
fun ChatHistoryMessage.toItem(): ChatItem {
    val assistant = role == "assistant"
    val kind = when (kind) {
        ChatHistoryMessage.Kind.Proposal -> ChatKind.Proposal
        ChatHistoryMessage.Kind.Summary -> ChatKind.Summary
        else -> ChatKind.Text
    }
    return ChatItem(
        id = id,
        role = if (assistant) ChatRole.Assistant else ChatRole.User,
        content = content,
        kind = kind,
        proposal = proposal,
        fact = factProposal,
        photoNote = attachment?.reading?.let { "Photo attached: what the coach read — $it" },
        feedbackUp = when (feedback) {
            ChatHistoryMessage.Feedback.Up -> true
            ChatHistoryMessage.Feedback.Down -> false
            else -> null
        },
        rateable = assistant && kind != ChatKind.Summary,
        safety = safetyNotice,
        fromNotes = ragInfo.fromNotes(),
    )
}

private fun ChatRagInfo?.fromNotes(): Boolean = this != null && source == ChatRagInfo.Source.Rag && chunkCount > 0

/** The reply after one stream event: text appends, the rest attach. */
fun ChatItem.apply(event: ChatStreamEvent): ChatItem {
    var item = this
    event.ragInfo?.let { item = item.copy(fromNotes = it.fromNotes()) }
    event.safetyNotice?.let { item = item.copy(safety = it) }
    event.text?.let { item = item.copy(content = item.content + it) }
    event.planProposal?.let { item = item.copy(proposal = it, kind = ChatKind.Proposal) }
    event.factProposal?.let { item = item.copy(fact = it) }
    event.error?.let { item = item.copy(failure = ChatFailure(event.reason ?: GENERIC_FAILURE, retryable = it != "auth-expired")) }
    return item
}

/** The progress line for a stream status (client/src/hooks/chat/chatProgress.ts). */
fun statusLabel(status: ChatStreamEvent.Status?): String = when (status) {
    ChatStreamEvent.Status.DraftingPlan -> "Checking your plan..."
    ChatStreamEvent.Status.LookingUpWorkouts -> "Looking through your workouts..."
    ChatStreamEvent.Status.LookingUpExercises -> "Checking your exercise history..."
    ChatStreamEvent.Status.LookingUpRecords -> "Checking your personal records..."
    ChatStreamEvent.Status.SearchingNotes -> "Searching your coaching notes..."
    else -> "Thinking..."
}

private const val TOO_MANY = 429
private const val BAD_GATEWAY = 502
private const val UNAVAILABLE = 503
private val CLIENT_ERRORS = 400..499

/** What to tell the athlete when a send fails (client/src/lib/chatErrors.ts). */
fun chatFailure(error: Throwable): ChatFailure = when {
    error !is ApiException -> ChatFailure("Your connection dropped. Check your internet and try again.", retryable = true)
    error.code == "RATE_LIMITED" -> ChatFailure("You're sending messages too quickly. Please wait about a minute and try again.", true)
    error.code == "AI_BUDGET_EXCEEDED" -> ChatFailure("You've reached your daily AI usage limit. Please try again later.", false)
    error.code == "AI_FEATURES_DISABLED" -> ChatFailure("AI coaching is switched off for now. Please try again later.", false)
    error.code == "AI_GLOBAL_BUDGET_EXCEEDED" -> ChatFailure("The AI coach is very busy right now. Please try again later.", false)
    error.code == "CHAT_PHOTO_UNREADABLE" -> ChatFailure("Couldn't read that photo. Try again, or say what it shows.", true)
    error.status == TOO_MANY -> ChatFailure("You're sending messages too quickly. Please wait about a minute and try again.", true)
    error.status in CLIENT_ERRORS -> ChatFailure(error.message?.takeIf { it != "HTTP ${error.status}" } ?: GENERIC_FAILURE, false)
    error.status == BAD_GATEWAY || error.status == UNAVAILABLE -> ChatFailure(GENERIC_FAILURE, true)
    else -> ChatFailure(GENERIC_FAILURE, true)
}

/** "Proposed plan changes (N days)" and the closed-state headers (PlanProposalCard.tsx). */
fun proposalHeader(proposal: PlanProposal): String {
    val n = proposal.changes.size
    val applied = proposal.appliedPlanDayIds?.size ?: n
    return when (proposal.status) {
        PlanProposal.Status.Pending -> "Proposed plan changes ($n ${if (n == 1) "day" else "days"})"
        PlanProposal.Status.Applied -> if (applied >=
            n
        ) {
            "Applied — $n ${if (n == 1) "day" else "days"} updated"
        } else {
            "Applied — $applied of $n changes"
        }
        PlanProposal.Status.Dismissed -> "Dismissed — plan not changed"
        PlanProposal.Status.Superseded -> "Replaced by a newer proposal"
        PlanProposal.Status.Invalidated -> "Out of date — not applied"
        PlanProposal.Status.Reverted -> "Undone — plan restored"
        else -> "Plan changes"
    }
}

fun changeKindLabel(kind: PlanProposal.ChangesItem.Kind): String = when (kind) {
    PlanProposal.ChangesItem.Kind.Reschedule -> "Rescheduled"
    PlanProposal.ChangesItem.Kind.WorkoutUpdate -> "Workout updated"
    PlanProposal.ChangesItem.Kind.RestConversion -> "Rest day"
    PlanProposal.ChangesItem.Kind.Tune -> "Tuned"
    else -> "Changed"
}

/** The "old → new" rows of a change, in the web's order (Date, Focus, Main workout, Accessory, Notes, Duration, RPE). */
fun changeRows(change: PlanProposal.ChangesItem): List<Triple<String, String?, String>> {
    val new = change.updatedFields
    val old = change.baseline
    return buildList {
        new.scheduledDate?.let { add(Triple("Date", old.scheduledDate, it)) }
        new.focus?.let { add(Triple("Focus", old.focus, it)) }
        new.mainWorkout?.let { add(Triple("Main workout", old.mainWorkout, it)) }
        new.accessory?.let { add(Triple("Accessory", old.accessory, it)) }
        new.notes?.let { add(Triple("Notes", old.notes, it)) }
        new.expectedDurationMin?.let { add(Triple("Duration", old.expectedDurationMin?.let { d -> "${d.toInt()} min" }, "$it min")) }
        new.expectedRpe?.let { add(Triple("RPE", old.expectedRpe?.let { r -> r.toInt().toString() }, it.toString())) }
    }
}
