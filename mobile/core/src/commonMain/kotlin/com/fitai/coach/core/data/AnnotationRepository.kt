package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PatchTimelineAnnotationsByIdRequest
import com.fitai.coach.core.api.generated.PostTimelineAnnotationsRequest
import com.fitai.coach.core.api.generated.TimelineAnnotation
import kotlinx.coroutines.flow.Flow
import kotlinx.serialization.builtins.ListSerializer

/** A training note as the editor holds it: what kind, which days, and what happened. */
public data class AnnotationDraft(val type: TimelineAnnotation.Type, val startDate: String, val endDate: String, val note: String)

/**
 * Training notes on the timeline: an injury, illness, travel or rest block
 * over a span of days, shown on the day it starts. Kept on the device;
 * changes are online.
 *
 * The write calls throw [com.fitai.coach.core.api.ApiException] on an error response.
 */
public class AnnotationRepository(private val api: ApiClient, private val cache: CacheStore) {
    public val annotations: Flow<List<TimelineAnnotation>?> = cache.observe(KEY, LIST)

    public suspend fun refresh() {
        cache.put(KEY, LIST, api.call(ApiEndpoints.GetTimelineAnnotations))
    }

    /** Adds a note, or (with [id]) changes one, then refreshes the list. */
    public suspend fun save(id: String?, draft: AnnotationDraft) {
        val text = draft.note.trim()
        if (id == null) {
            val type = PostTimelineAnnotationsRequest.Type.entries.first { it.wireValue == draft.type.wireValue }
            api.call(
                ApiEndpoints.PostTimelineAnnotations,
                PostTimelineAnnotationsRequest(
                    draft.startDate,
                    draft.endDate,
                    type,
                    note = if (text.isEmpty()) Patch.Absent else Patch.of(text),
                ),
            )
        } else {
            val type = PatchTimelineAnnotationsByIdRequest.Type.entries.first { it.wireValue == draft.type.wireValue }
            api.call(
                ApiEndpoints.PatchTimelineAnnotationsById,
                PatchTimelineAnnotationsByIdRequest(
                    draft.startDate,
                    draft.endDate,
                    type,
                    note = if (text.isEmpty()) Patch.clear() else Patch.of(text),
                ),
                ApiEndpoints.PatchTimelineAnnotationsById.path(id),
            )
        }
        refresh()
    }

    public suspend fun delete(id: String) {
        api.call(ApiEndpoints.DeleteTimelineAnnotationsById, path = ApiEndpoints.DeleteTimelineAnnotationsById.path(id))
        refresh()
    }

    private companion object {
        const val KEY = "timeline-annotations"
        val LIST = ListSerializer(TimelineAnnotation.serializer())
    }
}
