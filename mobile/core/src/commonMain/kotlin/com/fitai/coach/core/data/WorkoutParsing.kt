package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiClient
import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.CreateWorkoutRequest
import com.fitai.coach.core.api.generated.ParseWorkoutStructureResponse
import com.fitai.coach.core.api.generated.ParsedExercise
import com.fitai.coach.core.api.generated.ParsedStructureBlock
import com.fitai.coach.core.api.generated.PostParseWorkoutStructureFromImageRequest
import com.fitai.coach.core.api.generated.PostParseWorkoutStructureRequest

/** The longest workout description the parser takes (shared/schema/types/requests.ts). */
public const val MAX_PARSE_TEXT: Int = 2000

/** A photo ready to send: JPEG, PNG or WebP, base64 without a `data:` prefix. */
public data class EncodedImage(val base64: String, val mimeType: String = "image/jpeg")

/**
 * The AI parsing behind logging a workout: a description or a photo becomes
 * exercise rows the athlete confirms. Online only; the AI consent and budget
 * checks apply (403 AI_COACH_DISABLED, 429).
 */
public class WorkoutParser(private val api: ApiClient) {
    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun parseText(text: String): ParseWorkoutStructureResponse =
        api.call(ApiEndpoints.PostParseWorkoutStructure, PostParseWorkoutStructureRequest(text = text.take(MAX_PARSE_TEXT)))

    /** @throws com.fitai.coach.core.api.ApiException on an error response. */
    public suspend fun parseImage(image: EncodedImage): ParseWorkoutStructureResponse {
        val mime = PostParseWorkoutStructureFromImageRequest.MimeType.entries.firstOrNull { it.wireValue == image.mimeType }
            ?: PostParseWorkoutStructureFromImageRequest.MimeType.ImageJpeg
        return api.call(
            ApiEndpoints.PostParseWorkoutStructureFromImage,
            PostParseWorkoutStructureFromImageRequest(mimeType = mime, imageBase64 = image.base64),
        )
    }
}

/**
 * Parsed rows as the create request takes them. The two schemas share their
 * field names, so the conversion goes through JSON: fields the request
 * doesn't have (the parser's `missingFields`) are dropped on the way.
 */
public fun ParsedExercise.toCreateExercise(): CreateWorkoutRequest.ExercisesItem =
    ApiJson.decodeFromJsonElement(
        CreateWorkoutRequest.ExercisesItem.serializer(),
        ApiJson.encodeToJsonElement(ParsedExercise.serializer(), this),
    )

public fun ParsedStructureBlock.toCreateBlock(): CreateWorkoutRequest.StructureBlocksItem = ApiJson.decodeFromJsonElement(
    CreateWorkoutRequest.StructureBlocksItem.serializer(),
    ApiJson.encodeToJsonElement(ParsedStructureBlock.serializer(), this),
)
