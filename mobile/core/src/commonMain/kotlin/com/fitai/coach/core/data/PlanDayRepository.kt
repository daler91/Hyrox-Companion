package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.ExerciseSetRow
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetOrderRequest
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdSetsBySetIdRequest
import com.fitai.coach.core.api.generated.PlanDayReparseResponse
import com.fitai.coach.core.api.generated.PostPlansDaysByDayIdReparseFromImageRequest
import com.fitai.coach.core.api.generated.PostPlansDaysByDayIdReparseRequest
import com.fitai.coach.core.api.generated.PostPlansDaysByDayIdSetsRequest
import kotlinx.serialization.builtins.ListSerializer

/**
 * A plan day's prescribed sets, edited as the web's plan-day sheets do:
 * online, since the server gives new sets their ids and re-parsing is AI
 * work. The day's own text, title and priority go through
 * [TimelineRepository.editPlanDay] instead, which works offline.
 *
 * Every call throws [ApiException] on an error response.
 */
public class PlanDayRepository(private val api: ApiClient) {
    /** The day's sets, in their order. */
    public suspend fun sets(planDayId: String): List<ExerciseSetRow> = ApiJson.decodeFromJsonElement(
        ListSerializer(ExerciseSetRow.serializer()),
        api.call(ApiEndpoints.GetPlansDaysByDayIdSets, path = ApiEndpoints.GetPlansDaysByDayIdSets.path(planDayId)),
    )

    public suspend fun addSet(planDayId: String, request: PostPlansDaysByDayIdSetsRequest): ExerciseSetRow =
        api.call(ApiEndpoints.PostPlansDaysByDayIdSets, request, ApiEndpoints.PostPlansDaysByDayIdSets.path(planDayId))

    /** Saves [patch] against the set's [version]; a 409 means another device changed it first. */
    public suspend fun updateSet(
        planDayId: String,
        setId: String,
        version: Long,
        patch: PatchPlansDaysByDayIdSetsBySetIdRequest,
    ): ExerciseSetRow =
        api.call(
            ApiEndpoints.PatchPlansDaysByDayIdSetsBySetId,
            patch.copy(expectedVersion = version),
            ApiEndpoints.PatchPlansDaysByDayIdSetsBySetId.path(dayId = planDayId, setId = setId),
        )

    /** Removes a set; one the server no longer has is gone already. */
    public suspend fun deleteSet(planDayId: String, setId: String) {
        try {
            api.call(
                ApiEndpoints.DeletePlansDaysByDayIdSetsBySetId,
                path = ApiEndpoints.DeletePlansDaysByDayIdSetsBySetId.path(dayId = planDayId, setId = setId),
            )
        } catch (e: ApiException) {
            if (e.status != NOT_FOUND) throw e
        }
    }

    /** Puts the day's sets in the order of [setIds]; the answer is the sets in their new order. */
    public suspend fun reorder(planDayId: String, setIds: List<String>): List<ExerciseSetRow> = api.call(
        ApiEndpoints.PatchPlansDaysByDayIdSetOrder,
        PatchPlansDaysByDayIdSetOrderRequest(setIds),
        ApiEndpoints.PatchPlansDaysByDayIdSetOrder.path(planDayId),
    )

    /**
     * Turns the day's text into sets, replacing the ones it has. With
     * [mainWorkout] or [accessory], that text is parsed and saved as the day's.
     */
    public suspend fun reparse(
        planDayId: String,
        mainWorkout: String? = null,
        accessory: String? = null,
    ): PlanDayReparseResponse = api.call(
        ApiEndpoints.PostPlansDaysByDayIdReparse,
        PostPlansDaysByDayIdReparseRequest(
            mainWorkout = mainWorkout?.let { Patch.of(it) } ?: Patch.Absent,
            accessory = accessory?.let { Patch.of(it) } ?: Patch.Absent,
        ),
        ApiEndpoints.PostPlansDaysByDayIdReparse.path(planDayId),
    )

    /** Reads the sets from a photo of a session (a whiteboard, a coach's sheet), replacing the day's. */
    public suspend fun reparseFromImage(planDayId: String, photo: EncodedImage): PlanDayReparseResponse = api.call(
        ApiEndpoints.PostPlansDaysByDayIdReparseFromImage,
        PostPlansDaysByDayIdReparseFromImageRequest(
            mimeType = PostPlansDaysByDayIdReparseFromImageRequest.MimeType.entries.firstOrNull { it.wireValue == photo.mimeType }
                ?: PostPlansDaysByDayIdReparseFromImageRequest.MimeType.ImageJpeg,
            imageBase64 = photo.base64,
        ),
        ApiEndpoints.PostPlansDaysByDayIdReparseFromImage.path(planDayId),
    )

    private companion object {
        const val NOT_FOUND = 404
    }
}
