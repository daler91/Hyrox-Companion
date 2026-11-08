package com.fitai.coach.core.api

import com.fitai.coach.core.api.generated.ApiEndpoints
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class RuntimeTest {
    @Test
    fun patchLeavesAbsentFieldsOutAndSendsNullToClear() {
        val body = UpdateUserPreferences(age = Patch.clear(), heightCm = Patch.of(180.5), weeklyGoal = 4)

        assertEquals("""{"weeklyGoal":4,"age":null,"heightCm":180.5}""", ApiJson.encodeToString(UpdateUserPreferences.serializer(), body))
        assertEquals("{}", ApiJson.encodeToString(UpdateUserPreferences.serializer(), UpdateUserPreferences()))
    }

    @Test
    fun patchDecodesPresentNullAsAValueAndMissingAsAbsent() {
        val decoded = ApiJson.decodeFromString(UpdateUserPreferences.serializer(), """{"age":null,"maxHr":190}""")

        assertEquals(Patch.Value(null), decoded.age)
        assertEquals(Patch.Value(190), decoded.maxHr)
        assertEquals(Patch.Absent, decoded.ftp)
    }

    @Serializable(with = Color.Serializer::class)
    enum class Color(override val wireValue: String) : WireEnum {
        Red("red"),
        DeepBlue("deep_blue"),
        Unknown(""),
        ;

        internal object Serializer : WireEnumSerializer<Color>("Color", Color.entries, Unknown)
    }

    @Test
    fun enumsDecodeUnknownValuesAsUnknown() {
        assertEquals(Color.DeepBlue, ApiJson.decodeFromString(Color.serializer(), "\"deep_blue\""))
        assertEquals(Color.Unknown, ApiJson.decodeFromString(Color.serializer(), "\"ultraviolet\""))
        // The empty wire value of Unknown is not a way in.
        assertEquals(Color.Unknown, ApiJson.decodeFromString(Color.serializer(), "\"\""))
    }

    @Test
    fun enumsRefuseToSendUnknown() {
        assertEquals("\"red\"", ApiJson.encodeToString(Color.serializer(), Color.Red))
        assertFailsWith<SerializationException> { ApiJson.encodeToString(Color.serializer(), Color.Unknown) }
    }

    @Test
    fun pathsFillAndPercentEncodeParameters() {
        assertEquals("/api/v1/workouts/abc-123", ApiEndpoints.GetWorkoutsById.path(id = "abc-123"))
        assertEquals("/api/v1/workouts/a%2Fb%20c%C3%A9", ApiEndpoints.GetWorkoutsById.path(id = "a/b cé"))
        assertEquals("GET /api/v1/workouts/{id}", ApiEndpoints.GetWorkoutsById.toString())
    }

    @Test
    fun everyEndpointIsIndexedOnce() {
        assertEquals(ApiEndpoints.all.size, ApiEndpoints.all.values.toSet().size)
        assertEquals(ApiEndpoints.GetWorkoutsById, ApiEndpoints.all["GetWorkoutsById"])
    }
}
