package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.GetWeeklyReviewQuery
import com.fitai.coach.core.api.generated.PostWeeklyReviewIntentRequest
import com.fitai.coach.core.api.generated.WeeklyReview
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.serializer

/**
 * The weekly review: one Monday-to-Sunday week as the server resolves it in
 * the athlete's timezone. Online, as on the web; only the timeline prompt's
 * dismissal is kept on the device.
 *
 * The calls throw [com.fitai.coach.core.api.ApiException] on an error response.
 */
public class ReviewRepository(private val api: ApiClient, private val cache: CacheStore) {
    /** The week holding [week] (any date in it); the last completed week when null. */
    public suspend fun review(week: String?): WeeklyReview =
        api.call(ApiEndpoints.GetWeeklyReview, query = GetWeeklyReviewQuery(week = week).toQueryParameters())

    /** Saves the one line to carry into the week after [weekStart] (null clears it); returns what the server kept. */
    public suspend fun setIntent(weekStart: String, intent: String?): String? = api.call(
        ApiEndpoints.PostWeeklyReviewIntent,
        PostWeeklyReviewIntentRequest(weekStart, if (intent == null) Patch.clear() else Patch.of(intent)),
    ).intent

    /** The Monday whose timeline prompt was dismissed; one dismissal holds for that week's whole window. */
    public val dismissedPrompt: Flow<String?> = cache.observe(PROMPT_KEY, String.serializer())

    public suspend fun dismissPrompt(weekStart: String) {
        cache.put(PROMPT_KEY, String.serializer(), weekStart)
    }

    private companion object {
        const val PROMPT_KEY = "weekly-review-prompt-dismissed"
    }
}
