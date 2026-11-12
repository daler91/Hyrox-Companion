package com.fitai.coach.core.data

import com.fitai.coach.core.api.ApiJson
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MyFoodsTest {
    private val server = FakeServer()
    private val db = testDatabaseStore().open("u1")
    private val nutrition = NutritionRepository(server.api, CacheStore(db) { 0L })
    private val myFoods = nutrition.myFoods

    @AfterTest
    fun closeDatabase() = db.close()

    private fun food(id: String, name: String, isPublic: Boolean = false) =
        """{"id":"$id","source":"custom","name":"$name","caloriesPer100g":250,"createdByUserId":"u1","isPublic":$isPublic,""" +
            """"createdAt":"2026-11-01T00:00:00Z","updatedAt":"2026-11-01T00:00:00Z"}"""

    private fun summary(calories: Int) =
        """{"logDate":"2026-11-08","totals":{"calories":$calories,"protein":0,"carb":0,"fat":0,"fiber":0},""" +
            """"meals":{"breakfast":[],"lunch":[],"dinner":[],"snack":[],"snack_pm":[],"pre_workout":[],"post_workout":[]}}"""

    @Test
    fun aNewCustomFoodIsSentWithItsPortionsAndTheListRefreshed() = runTest {
        server.on("POST", "/api/v1/nutrition/foods", 201, food("c1", "Granola"))
        server.on("GET", "/api/v1/nutrition/foods/custom", 200, "[${food("c1", "Granola")}]")

        val created = myFoods.createFood(
            CustomFoodDraft("Granola", null, 450.0, 10.0, 60.0, 18.0, null, 45.0),
            listOf(Portion("1 bowl", 60.0)),
        )

        assertEquals("c1", created.id)
        val sent = ApiJson.parseToJsonElement(server.sentTo("POST", "/api/v1/nutrition/foods").single().body!!).jsonObject
        assertEquals("Granola", sent["name"]!!.jsonPrimitive.content)
        assertEquals(JsonNull, sent["brand"])
        assertEquals(JsonNull, sent["fiberPer100g"])
        assertEquals(450.0, sent["caloriesPer100g"]!!.jsonPrimitive.content.toDouble())
        assertEquals("""[{"label":"1 bowl","grams":60.0}]""", sent["servings"].toString())
        assertEquals(listOf("Granola"), myFoods.customFoods().first()!!.map { it.name })
    }

    @Test
    fun anEditedFoodIsSharedAndEveryCachedDayDropped() = runTest {
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(100))
        nutrition.refreshDay("2026-11-07")
        server.on("PATCH", "/api/v1/nutrition/foods/c1", 200, food("c1", "Granola", isPublic = true))
        server.on("GET", "/api/v1/nutrition/foods/custom", 200, "[${food("c1", "Granola", isPublic = true)}]")
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(300))

        myFoods.updateFood(
            "c1",
            CustomFoodDraft("Granola", "Acme", 450.0, null, null, null, null, null),
            isPublic = true,
            date = "2026-11-08",
        )

        val sent = ApiJson.parseToJsonElement(server.sentTo("PATCH", "/api/v1/nutrition/foods/c1").single().body!!).jsonObject
        assertEquals("true", sent["isPublic"]!!.jsonPrimitive.content)
        assertEquals("Acme", sent["brand"]!!.jsonPrimitive.content)
        // Its entries read it live on any day: the other days refetch when next opened.
        assertNull(nutrition.day("2026-11-07").first())
        assertEquals(300.0, nutrition.day("2026-11-08").first()!!.totals.calories)
    }

    @Test
    fun aPortionIsAddedToAFoodAndRemovedByItsId() = runTest {
        server.on(
            "POST",
            "/api/v1/nutrition/foods/f1/servings",
            201,
            """{"id":"s1","foodId":"f1","label":"1 slice","grams":35,"createdByUserId":"u1"}""",
        )
        server.on("DELETE", "/api/v1/nutrition/foods/f1/servings/s1", 200, """{"success":true}""")

        val serving = myFoods.addPortion("f1", Portion("1 slice", 35.0))
        myFoods.removePortion("f1", serving.id)

        assertEquals("""{"label":"1 slice","grams":35.0}""", server.sentTo("POST", "/api/v1/nutrition/foods/f1/servings").single().body)
        assertEquals(1, server.sentTo("DELETE", "/api/v1/nutrition/foods/f1/servings/s1").size)
    }

    @Test
    fun aDeletedFoodLeavesTheList() = runTest {
        server.on("DELETE", "/api/v1/nutrition/foods/c1", 200, """{"success":true}""")
        server.on("GET", "/api/v1/nutrition/foods/custom", 200, "[]")

        myFoods.deleteFood("c1")

        assertEquals(emptyList(), myFoods.customFoods().first())
    }

    @Test
    fun aRecipeIsCreatedReplacedAndDeletedWithItsListRefreshed() = runTest {
        val recipe = """{"id":"r1","name":"Overnight oats","servings":2,"foodId":"rf1","totalGrams":300,""" +
            """"perServing":{"calories":300,"protein":12,"carb":45,"fat":8,"fiber":5},"ingredients":[]}"""
        server.on("POST", "/api/v1/nutrition/recipes", 201, recipe)
        server.on("GET", "/api/v1/nutrition/recipes", 200, """[{"id":"r1","name":"Overnight oats","servings":2,"foodId":"rf1"}]""")

        val draft = RecipeDraft("Overnight oats", 2.0, listOf(RecipeDraft.Ingredient("f1", 80.0), RecipeDraft.Ingredient("f2", 220.0)))
        assertEquals("rf1", myFoods.createRecipe(draft).foodId)

        assertEquals(
            """{"name":"Overnight oats","servings":2.0,"ingredients":""" +
                """[{"foodId":"f1","quantityG":80.0},{"foodId":"f2","quantityG":220.0}]}""",
            server.sentTo("POST", "/api/v1/nutrition/recipes").single().body,
        )
        assertEquals(listOf("Overnight oats"), myFoods.recipes().first()!!.map { it.name })

        // A replaced recipe changes what its entries add up to, on any day.
        server.on("PATCH", "/api/v1/nutrition/recipes/r1", 200, recipe)
        server.on("GET", "/api/v1/nutrition/summary", 200, summary(600))
        myFoods.updateRecipe("r1", draft.copy(servings = 3.0), "2026-11-08")
        assertEquals(1, server.sentTo("PATCH", "/api/v1/nutrition/recipes/r1").size)
        assertEquals(600.0, nutrition.day("2026-11-08").first()!!.totals.calories)

        server.on("DELETE", "/api/v1/nutrition/recipes/r1", 200, """{"success":true}""")
        server.on("GET", "/api/v1/nutrition/recipes", 200, "[]")
        myFoods.deleteRecipe("r1")
        assertEquals(emptyList(), myFoods.recipes().first())
    }
}
