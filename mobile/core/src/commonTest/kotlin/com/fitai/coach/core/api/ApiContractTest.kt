package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ApiEndpoints
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.test.fail

/**
 * Every generated model against JSON built from its own schema
 * (resources/api-samples, written by `pnpm mobile:models`):
 *  - every response variant decodes, including `future`: an unknown property
 *    and enum values this build does not list, as a newer server could send;
 *  - every request variant decodes and re-encodes to the same JSON, so what
 *    the app sends is what the schema describes, `Patch` fields included.
 * Failures are collected so one run lists every broken endpoint.
 */
class ApiContractTest {
    private val endpoints = ApiEndpoints.all

    private fun samples(name: String): JsonObject? =
        readTestResource("api-samples/$name.json")?.let { ApiJson.parseToJsonElement(it).jsonObject }

    @Test
    fun samplesExistForEveryEndpointWithABody() {
        val missing = endpoints.filter { (name, endpoint) ->
            (endpoint.requestSerializer != null || endpoint.responseSerializer != null) && samples(name) == null
        }.keys
        assertEquals(emptySet(), missing, "Run `pnpm mobile:models` to regenerate the samples")
    }

    @Test
    fun everyResponseVariantDecodes() {
        val failures = mutableListOf<String>()
        var decoded = 0
        for ((name, endpoint) in endpoints) {
            val serializer = endpoint.responseSerializer ?: continue
            val response = samples(name)?.get("response")?.jsonObject ?: continue
            for (variant in listOf("min", "max", "future")) {
                val json = response[variant] ?: continue
                runCatching { ApiJson.decodeFromJsonElement(serializer, json) }
                    .onSuccess { decoded++ }
                    .onFailure { failures += "$name response/$variant: ${it.message?.lineSequence()?.first()}" }
            }
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
        assertTrue(decoded > 300, "Expected samples for most endpoints, decoded $decoded")
    }

    @Test
    fun everyRequestVariantRoundTrips() {
        val failures = mutableListOf<String>()
        for ((name, endpoint) in endpoints) {
            val serializer = endpoint.requestSerializer ?: continue
            val request = samples(name)?.get("request")?.jsonObject ?: continue
            for (variant in listOf("min", "max")) {
                val json = request[variant] ?: continue
                runCatching { roundTrip(serializer, json) }
                    .onSuccess { if (it != json) failures += "$name request/$variant: sent $it, expected $json" }
                    .onFailure { failures += "$name request/$variant: ${it.message?.lineSequence()?.first()}" }
            }
        }
        if (failures.isNotEmpty()) fail(failures.joinToString("\n"))
    }

    private fun <T> roundTrip(serializer: KSerializer<T>, json: JsonElement): JsonElement =
        ApiJson.encodeToJsonElement(serializer, ApiJson.decodeFromJsonElement(serializer, json))
}
