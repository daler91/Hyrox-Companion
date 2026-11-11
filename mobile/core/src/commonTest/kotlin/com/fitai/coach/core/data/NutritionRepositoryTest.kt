package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

class NutritionRepositoryTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val nutrition = NutritionRepository(server.api, CacheStore(db) { 0L })

    @AfterTest
    fun closeDatabase() = db.close()

    private fun summary(calories: Int) =
        """{"logDate":"2026-11-08","totals":{"calories":$calories,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

    @Test
    fun aDayIsCachedOnceFetchedAndRefreshedAfterALog() = runTest {
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))
        nutrition.refreshDay("2026-11-08")
        assertEquals(0.0, nutrition.day("2026-11-08").first()!!.totals.calories)

        server.on("POST", "/api/v1/nutrition/logs", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(250))
        nutrition.log("f1", 100.0, Meal.Breakfast, "2026-11-08T08:00:00Z", "2026-11-08")

        assertEquals(250.0, nutrition.day("2026-11-08").first()!!.totals.calories)
        val logged = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/logs").single().body!!).jsonObject
        assertEquals("breakfast", logged["mealType"]!!.jsonPrimitive.content)
        assertNull(nutrition.day("2026-11-07").first())
    }

    @Test
    fun savingTargetsCarriesTheTrainingLoadSettingsOver() = runTest {
        server.on(
            "GET",
            "/api/v1/nutrition/targets",
            200,
            """{"current":{"id":"t1","userId":"u1","calories":2400,"proteinG":150,"periodizationEnabled":true,"referenceUtss":60,""" +
                """"recoveryEnabled":true,"phaseAware":false,"effectiveFrom":"2026-10-01"},"history":[]}""",
        )
        server.on("POST", "/api/v1/nutrition/targets", 201)
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))

        nutrition.saveTargets(MacroTargets(calories = 2600.0, proteinG = null, carbG = 300.0, fatG = 80.0), "2026-11-08")

        val sent = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/targets").single().body!!).jsonObject
        assertEquals(2600.0, sent["calories"]!!.jsonPrimitive.content.toDouble())
        assertEquals(JsonNull, sent["proteinG"])
        assertEquals("true", sent["periodizationEnabled"]!!.jsonPrimitive.content)
        assertEquals(60.0, sent["referenceUtss"]!!.jsonPrimitive.content.toDouble())
        assertNull(sent["id"])
        assertNull(sent["effectiveFrom"])
    }

    @Test
    fun aSwitchedOffFeatureIsRecognised() = runTest {
        server.on("GET", "/api/v1/nutrition/summary", 404, """{"error":"Not found","code":"NOT_FOUND"}""")

        val error = assertFailsWith<ApiException> { nutrition.refreshDay("2026-11-08") }

        assertTrue(error.isNutritionOff())
    }

    @Test
    fun aDescriptionIsCappedAndAPhotoKeepsItsTypeForTheParser() = runTest {
        val parsed = """{"items":[],"warnings":[],"rawInput":"eggs"}"""
        server.on("POST", "/api/v1/nutrition/parse/text", 200, parsed)
        server.on("POST", "/api/v1/nutrition/parse/photo", 200, parsed)

        nutrition.parseMealText("  " + "e".repeat(2500) + "  ")
        nutrition.parseMealPhoto(EncodedImage("abc", "image/png"))

        val text = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/parse/text").single().body!!).jsonObject
        assertEquals(2000, text["text"]!!.jsonPrimitive.content.length)
        val photo = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/parse/photo").single().body!!).jsonObject
        assertEquals("image/png", photo["mimeType"]!!.jsonPrimitive.content)
    }

    @Test
    fun aReviewedMealIsLoggedInOneBatchAndItsDayRefreshed() = runTest {
        server.on("POST", "/api/v1/nutrition/logs/batch", 201, """{"created":2,"logDate":"2026-11-08"}""")
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(420))

        val created = nutrition.logMeal(
            MealEntryMethod.Photo,
            rawInput = null,
            loggedAt = "2026-11-08T12:00:00Z",
            items = listOf(MealItem("f1", 120.0, Meal.Lunch, 0.9), MealItem("f2", 30.0, Meal.Lunch, null)),
            date = "2026-11-08",
        )

        assertEquals(2, created)
        assertEquals(420.0, nutrition.day("2026-11-08").first()!!.totals.calories)
        val batch = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/logs/batch").single().body!!).jsonObject
        assertEquals("photo", batch["entryMethod"]!!.jsonPrimitive.content)
        assertEquals(
            """[{"foodId":"f1","quantityG":120.0,"mealType":"lunch","parseConfidence":0.9},""" +
                """{"foodId":"f2","quantityG":30.0,"mealType":"lunch"}]""",
            batch["items"].toString(),
        )
    }
}
