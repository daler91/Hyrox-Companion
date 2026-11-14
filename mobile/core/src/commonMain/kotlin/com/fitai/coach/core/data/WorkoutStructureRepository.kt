package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.PatchWorkoutsByIdStructureBlocksByBlockIdScoreRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdReparseFromImageRequest
import com.fitai.coach.core.api.generated.PostWorkoutsByIdReparseRequest
import com.fitai.coach.core.api.generated.WorkoutReparseResponse
import com.fitai.coach.core.api.generated.WorkoutStructureBlock
import com.fitai.coach.core.structure.BlockScore
import com.fitai.coach.core.structure.blockScoreJson
import kotlinx.serialization.builtins.ListSerializer

/**
 * What a logged workout is made of, past its own fields: its sets read from
 * its text or a photo of the session, and the results of its structure
 * blocks. Online; the workout kept on the device follows each answer.
 */
public class WorkoutStructureRepository(
    private val db: FitaiDatabase,
    private val api: ApiClient,
    private val workouts: WorkoutRepository,
) {
    private val dao = db.workouts()

    /**
     * Records the athlete's result for an EMOM, AMRAP or rounds block, or
     * (null) clears it. Online; the workout kept on the device takes the
     * blocks the server answers with.
     *
     * @throws ApiException on an error response (a score whose type isn't the block's format is refused).
     */
    public suspend fun scoreBlock(workoutId: String, blockId: String, score: BlockScore?) {
        val blocks = api.call(
            ApiEndpoints.PatchWorkoutsByIdStructureBlocksByBlockIdScore,
            PatchWorkoutsByIdStructureBlocksByBlockIdScoreRequest(blockScoreJson(score)),
            ApiEndpoints.PatchWorkoutsByIdStructureBlocksByBlockIdScore.path(blockId = blockId, id = workoutId),
        ).structureBlocks
        val json = ApiJson.encodeToJsonElement(ListSerializer(WorkoutStructureBlock.serializer()), blocks)
        db.writeTransaction {
            dao.get(workoutId)?.let { row -> dao.upsert(row.copy(json = withField(row.json, "structureBlocks", json))) }
        }
    }

    /**
     * Reads the workout's text into sets, replacing its sets and structure
     * blocks, then fetches it. The server reads the text the workout has: its
     * prescription, else its description. Online.
     *
     * @throws ApiException on an error response (422: nothing could be read).
     */
    public suspend fun reparse(workoutId: String): WorkoutReparseResponse {
        val result = api.call(
            ApiEndpoints.PostWorkoutsByIdReparse,
            PostWorkoutsByIdReparseRequest(),
            ApiEndpoints.PostWorkoutsByIdReparse.path(workoutId),
        )
        workouts.refresh(workoutId)
        return result
    }

    /**
     * Reads the sets from a photo of the session (a whiteboard, a coach's
     * sheet), replacing the workout's, then fetches it. Online.
     *
     * @throws ApiException on an error response.
     */
    public suspend fun reparseFromImage(workoutId: String, photo: EncodedImage): WorkoutReparseResponse {
        val result = api.call(
            ApiEndpoints.PostWorkoutsByIdReparseFromImage,
            PostWorkoutsByIdReparseFromImageRequest(
                mimeType = PostWorkoutsByIdReparseFromImageRequest.MimeType.entries.firstOrNull { it.wireValue == photo.mimeType }
                    ?: PostWorkoutsByIdReparseFromImageRequest.MimeType.ImageJpeg,
                imageBase64 = photo.base64,
            ),
            ApiEndpoints.PostWorkoutsByIdReparseFromImage.path(workoutId),
        )
        workouts.refresh(workoutId)
        return result
    }
}
