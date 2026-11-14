package com.fitai.coach.core.nutrition

import com.fitai.coach.core.fixtures.assertFixtureSuite
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import kotlin.test.Test

/** Pins Micros.kt to shared/schema/micros.ts (script/mobile-fixtures/suites/micros.ts). */
class MicrosFixtureTest {
    @Test
    fun constants() = assertFixtureSuite("micros.constants") {
        buildJsonObject {
            put(
                "MICRO_DISPLAY_DEFS",
                JsonArray(
                    MICRO_DISPLAY_DEFS.map { def ->
                        buildJsonObject {
                            put("key", def.key)
                            put("label", def.label)
                            put("unit", def.unit.wireValue)
                            put("rdi", def.rdi)
                        }
                    },
                ),
            )
        }
    }
}
