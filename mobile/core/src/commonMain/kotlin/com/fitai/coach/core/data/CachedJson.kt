package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * Decodes a cached row, or null when it no longer decodes (a row written by
 * an older build whose model has since changed). The next refresh replaces it.
 */
internal fun <T> decodeOrNull(serializer: KSerializer<T>, json: String): T? = try {
    ApiJson.decodeFromString(serializer, json)
} catch (_: SerializationException) {
    null
} catch (_: IllegalArgumentException) {
    null
}

internal fun <T> encode(serializer: KSerializer<T>, value: T): String = ApiJson.encodeToString(serializer, value)

/**
 * Applies a PATCH body to a cached row the way the server applies it: each
 * field the body has replaces the row's (a null clears it), and every other
 * field is kept. Both are JSON objects.
 */
internal fun mergePatch(row: String, patch: String): String {
    val merged = ApiJson.parseToJsonElement(row).jsonObject + ApiJson.parseToJsonElement(patch).jsonObject
    return JsonObject(merged).toString()
}

/** [json] (an object, or null for an empty body) with [name] set to [value]. */
internal fun withField(json: String?, name: String, value: JsonElement): String {
    val fields = json?.let { ApiJson.parseToJsonElement(it).jsonObject }.orEmpty()
    return JsonObject(fields + (name to value)).toString()
}
