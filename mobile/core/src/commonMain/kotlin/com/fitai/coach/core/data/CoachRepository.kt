package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.ChatHistoryMessage
import com.fitai.coach.core.api.generated.ChatStreamEvent
import com.fitai.coach.core.api.generated.GetChatHistoryQuery
import com.fitai.coach.core.api.generated.GetChatWelcomeResponse
import com.fitai.coach.core.api.generated.PatchChatMessagesByIdRequest
import com.fitai.coach.core.api.generated.PlanProposal
import com.fitai.coach.core.api.generated.PostChatMessageRequest
import com.fitai.coach.core.api.generated.PostChatMessagesByIdFactRequest
import com.fitai.coach.core.api.generated.PostChatStreamRequest
import com.fitai.coach.core.api.generated.PostPlanProposalsByIdApplyRequest
import com.fitai.coach.core.api.generated.PostPlanProposalsByIdApplyResponse
import com.fitai.coach.core.api.generated.PostPlanProposalsByIdUndoResponse
import kotlinx.coroutines.flow.Flow

/** A page of the conversation, oldest first, and the cursor of the page before it (null at the start). */
public data class HistoryPage(val messages: List<ChatHistoryMessage>, val before: String?, val beforeId: String?) {
    val hasOlder: Boolean get() = before != null && beforeId != null
}

/**
 * The ids a chat turn is saved under: the athlete's message, the reply, and
 * the failed reply a retry replaces, if any.
 */
public data class ChatTurnIds(val user: String, val assistant: String, val replacing: String? = null)

/**
 * A workout's own thread with the coach: the plan day and/or logged workout
 * it is about. The coach sees that workout, and "make this day easier"
 * resolves to its plan day.
 */
public data class ChatFocus(val planDayId: String? = null, val workoutLogId: String? = null)

/** The longest message the coach takes (shared/schema/types/requests.ts). */
public const val MAX_CHAT_MESSAGE: Int = 4000

/** The largest photo the chat takes, in base64 characters ("Photo must be 3MB or less"). */
public const val MAX_CHAT_PHOTO_CHARS: Int = 4_194_304

/**
 * The AI coach: the conversation, streamed replies, and the plan changes it
 * proposes. Online only; replies need the athlete's AI consent
 * (403 AI_COACH_DISABLED otherwise).
 */
public class CoachRepository(private val api: ApiClient) {
    /** The greeting and quick actions for an opening panel. */
    public suspend fun welcome(): GetChatWelcomeResponse = api.call(ApiEndpoints.GetChatWelcome)

    /**
     * A page of the conversation: the main one, or [focus]'s thread. The
     * server's rolling summaries are left out.
     */
    public suspend fun history(
        before: String? = null,
        beforeId: String? = null,
        limit: Int = PAGE_SIZE,
        focus: ChatFocus? = null,
    ): HistoryPage {
        val query = GetChatHistoryQuery(
            limit = limit,
            before = before,
            beforeId = beforeId,
            focusPlanDayId = focus?.planDayId,
            focusWorkoutLogId = focus?.workoutLogId,
        ).toQueryParameters()
        val response = api.callWithHeaders(ApiEndpoints.GetChatHistory, query = query)
        return HistoryPage(
            messages = response.body.filter { it.kind != ChatHistoryMessage.Kind.Rolling },
            before = response.headers[NEXT_CURSOR],
            beforeId = response.headers[NEXT_CURSOR_ID],
        )
    }

    /**
     * Sends [message] and streams the reply's events. With the turn's [ids]
     * the server reads the conversation itself and saves both turns under
     * them; [focus] puts both turns in that workout's thread.
     */
    public fun send(
        message: String,
        ids: ChatTurnIds,
        photo: EncodedImage? = null,
        focus: ChatFocus? = null,
    ): Flow<ChatStreamEvent> = api.stream(
        ApiEndpoints.PostChatStream,
        PostChatStreamRequest(
            message = message,
            userMessageId = ids.user,
            assistantMessageId = ids.assistant,
            replaceAssistantId = ids.replacing,
            focusPlanDayId = focus?.planDayId,
            focusWorkoutLogId = focus?.workoutLogId,
            photo = photo?.let {
                PostChatStreamRequest.Photo(
                    mimeType = PostChatStreamRequest.Photo.MimeType.entries.firstOrNull { m -> m.wireValue == it.mimeType }
                        ?: PostChatStreamRequest.Photo.MimeType.ImageJpeg,
                    imageBase64 = it.base64,
                )
            },
        ),
    )

    /** Saves a turn the server didn't write itself (the "Done — I've updated…" after applying a change). */
    public suspend fun saveAssistantMessage(content: String) {
        api.call(ApiEndpoints.PostChatMessage, PostChatMessageRequest(role = PostChatMessageRequest.Role.Assistant, content = content))
    }

    /** Rates a reply; null clears the rating. */
    public suspend fun rate(messageId: String, up: Boolean?) {
        val feedback = up?.let { if (it) PatchChatMessagesByIdRequest.Feedback.Up else PatchChatMessagesByIdRequest.Feedback.Down }
        api.call(
            ApiEndpoints.PatchChatMessagesById,
            PatchChatMessagesByIdRequest(feedback),
            ApiEndpoints.PatchChatMessagesById.path(messageId),
        )
    }

    /** Saves the reply's offered fact to the athlete card, or turns it down. */
    public suspend fun decideFact(messageId: String, save: Boolean) {
        val decision = if (save) PostChatMessagesByIdFactRequest.Decision.Save else PostChatMessagesByIdFactRequest.Decision.Dismiss
        api.call(
            ApiEndpoints.PostChatMessagesByIdFact,
            PostChatMessagesByIdFactRequest(decision),
            ApiEndpoints.PostChatMessagesByIdFact.path(messageId),
        )
    }

    public suspend fun pendingProposal(): PlanProposal? = api.call(ApiEndpoints.GetPlanProposalsPending).proposal

    public suspend fun proposal(id: String): PlanProposal =
        api.call(ApiEndpoints.GetPlanProposalsById, path = ApiEndpoints.GetPlanProposalsById.path(id)).proposal

    /** Applies the proposal's changes: all of them, or the days in [planDayIds]. */
    public suspend fun applyProposal(id: String, planDayIds: List<String>? = null): PostPlanProposalsByIdApplyResponse = api.call(
        ApiEndpoints.PostPlanProposalsByIdApply,
        PostPlanProposalsByIdApplyRequest(planDayIds = planDayIds),
        ApiEndpoints.PostPlanProposalsByIdApply.path(id),
    )

    public suspend fun dismissProposal(id: String) {
        api.call(ApiEndpoints.PostPlanProposalsByIdDismiss, path = ApiEndpoints.PostPlanProposalsByIdDismiss.path(id))
    }

    public suspend fun undoProposal(id: String): PostPlanProposalsByIdUndoResponse =
        api.call(ApiEndpoints.PostPlanProposalsByIdUndo, path = ApiEndpoints.PostPlanProposalsByIdUndo.path(id))

    /** Deletes the whole conversation, every thread. */
    public suspend fun clearHistory() {
        api.call(ApiEndpoints.DeleteChatHistory)
    }

    private companion object {
        const val PAGE_SIZE = 50
        const val NEXT_CURSOR = "x-next-cursor"
        const val NEXT_CURSOR_ID = "x-next-cursor-id"
    }
}
