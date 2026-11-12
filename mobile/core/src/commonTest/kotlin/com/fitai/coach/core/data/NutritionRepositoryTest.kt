package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.ApiJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
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

    private fun entry(id: String) =
        """{"id":"$id","userId":"u1","foodId":"f1","loggedAt":"2026-11-08T08:00:00Z","logDate":"2026-11-08","quantityG":100,""" +
            """"mealType":"breakfast","entryMethod":"manual","pendingReview":false,"createdAt":"2026-11-08T08:00:00Z",""" +
            """"updatedAt":"2026-11-08T08:00:00Z"}"""

    private fun food(id: String, lastQuantityG: Int? = null) =
        """{"id":"$id","source":"usda","name":"Oats","isPublic":true,"createdAt":"2026-11-01T00:00:00Z",""" +
            """"updatedAt":"2026-11-01T00:00:00Z"${lastQuantityG?.let { ",\"lastQuantityG\":$it,\"lastMealType\":\"breakfast\"" } ?: ""}}"""

    private fun summary(calories: Int) =
        """{"logDate":"2026-11-08","totals":{"calories":$calories,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

    @Test
    fun aDayIsCachedOnceFetchedAndRefreshedAfterALog() = runTest {
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(0))
        nutrition.refreshDay("2026-11-08")
        assertEquals(0.0, nutrition.day("2026-11-08").first()!!.totals.calories)

        server.on("POST", "/api/v1/nutrition/logs", 201, entry("e1"))
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(250))
        server.on("GET", "/api/v1/nutrition/foods/recent", 200, "[${food("f1", lastQuantityG = 100)}]")
        val id = nutrition.log("f1", 100.0, Meal.Breakfast, "2026-11-08T08:00:00Z", "2026-11-08")

        assertEquals("e1", id)
        assertEquals(250.0, nutrition.day("2026-11-08").first()!!.totals.calories)
        // What was just logged moves up the recent foods.
        assertEquals(100.0, nutrition.shortcuts.recentFoods().first()!!.single().lastQuantityG)
        val logged = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/logs").single().body!!).jsonObject
        assertEquals("breakfast", logged["mealType"]!!.jsonPrimitive.content)
        assertNull(nutrition.day("2026-11-07").first())
    }

    @Test
    fun aLogStandsWhenTheRecentFoodsCannotBeRefreshed() = runTest {
        server.on("GET", "/api/v1/nutrition/foods/recent", 200, "[${food("f0")}]")
        nutrition.shortcuts.refreshRecentFoods()
        server.on("POST", "/api/v1/nutrition/logs", 201, entry("e1"))
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(250))
        server.on("GET", "/api/v1/nutrition/foods/recent", 500, """{"error":"boom"}""")

        assertEquals("e1", nutrition.log("f1", 100.0, Meal.Breakfast, "2026-11-08T08:00:00Z", "2026-11-08"))
        assertEquals("f0", nutrition.shortcuts.recentFoods().first()!!.single().id)
    }

    @Test
    fun favouritesAreCachedAndAStaleUnstarSucceeds() = runTest {
        server.on("POST", "/api/v1/nutrition/favorites", 201, """{"success":true}""")
        server.on("GET", "/api/v1/nutrition/favorites", 200, "[${food("f1")}]")
        nutrition.shortcuts.setFavorite("f1", favorite = true)

        assertEquals("""{"foodId":"f1"}""", server.sentTo("POST", "/api/v1/nutrition/favorites").single().body)
        assertEquals(listOf("f1"), nutrition.shortcuts.favorites().first()!!.map { it.id })

        // Already un-starred elsewhere: the 404 means it's done.
        server.on("DELETE", "/api/v1/nutrition/favorites/f1", 404, """{"error":"Not found","code":"NOT_FOUND"}""")
        server.on("GET", "/api/v1/nutrition/favorites", 200, "[]")
        nutrition.shortcuts.setFavorite("f1", favorite = false)

        assertEquals(emptyList(), nutrition.shortcuts.favorites().first())
    }

    @Test
    fun aRepeatedMealLandsOnTheTargetDayAndAnEmptyOneSaysSo() = runTest {
        server.on("POST", "/api/v1/nutrition/logs/repeat", 201, """{"created":2,"logDate":"2026-11-08"}""")
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(500))

        assertEquals(2L, nutrition.repeat("2026-11-07", "2026-11-08", Meal.Breakfast))

        val sent = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/logs/repeat").single().body!!).jsonObject
        assertEquals("2026-11-07", sent["sourceDate"]!!.jsonPrimitive.content)
        assertEquals("2026-11-08", sent["targetDate"]!!.jsonPrimitive.content)
        assertEquals("breakfast", sent["mealType"]!!.jsonPrimitive.content)
        assertEquals(500.0, nutrition.day("2026-11-08").first()!!.totals.calories)

        server.on(
            "POST",
            "/api/v1/nutrition/logs/repeat",
            404,
            """{"error":"No entries found to repeat for that day","code":"NOT_FOUND"}""",
        )
        val error = assertFailsWith<ApiException> { nutrition.repeat("2026-11-06", "2026-11-07") }
        assertTrue(error.isNothingToRepeat())
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
