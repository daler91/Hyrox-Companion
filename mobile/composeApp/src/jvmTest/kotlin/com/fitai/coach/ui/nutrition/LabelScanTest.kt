package com.fitai.coach.ui.nutrition

import com.fitai.coach.core.auth.AuthState
import com.fitai.coach.core.data.EncodedImage
import com.fitai.coach.core.data.JvmUserDatabaseStore
import com.fitai.coach.core.data.NutritionRepository
import com.fitai.coach.core.data.SessionManager
import com.fitai.coach.ui.FakeApi
import com.fitai.coach.ui.FakeAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.filterNotNull
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.withTimeout
import java.nio.file.Files
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * A nutrition label photo, read and reviewed: it opens the custom food sheet
 * filled in, and "Save & log" hands the new food on for logging. Runs on the
 * desktop with a real database; the photo comes straight in, as from the camera.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class LabelScanTest {
    private val directory = Files.createTempDirectory("fitai-label").toFile()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val api = FakeApi()
    private val sessions = SessionManager(FakeAuth(AuthState.SignedIn("u1")), JvmUserDatabaseStore(directory), api.client)
    private lateinit var nutrition: NutritionRepository

    @BeforeTest
    fun setUp() {
        // Unconfined: the view model takes in its AI setting as it's made, as
        // the screen has by the time the athlete taps.
        Dispatchers.setMain(Dispatchers.Unconfined)
        sessions.start(scope)
        nutrition = runBlocking { withTimeout(TIMEOUT_MS) { sessions.session.filterNotNull().first() }.nutrition }
    }

    @AfterTest
    fun tearDown() {
        runBlocking { sessions.signOut() }
        scope.cancel()
        Dispatchers.resetMain()
        directory.deleteRecursively()
    }

    private fun capture(aiOn: Boolean = true, enableAi: suspend () -> Unit = {}) = MealCaptureViewModel(
        nutrition = nutrition,
        aiEnabled = flowOf(aiOn),
        enableAi = enableAi,
        currentHour = { 8 },
        loggedAt = { "${it}T08:00:00Z" },
    )

    @Test
    fun aReadLabelOpensForReviewAndSaveAndLogHandsTheFoodOn() = runBlocking {
        api.on("POST", "/api/v1/nutrition/parse/label", LABEL)
        api.on("POST", "/api/v1/nutrition/foods", CREATED, status = 201)
        api.on("GET", "/api/v1/nutrition/foods/custom", "[$CREATED]")
        val capture = capture()
        val myFoods = MyFoodsViewModel(nutrition.myFoods, nutrition::search, openDate = { "2026-11-12" })

        capture.parseLabel(EncodedImage("abc", "image/webp"))
        val read = withTimeout(TIMEOUT_MS) { capture.labels.first() }
        assertEquals(
            "image/webp",
            api.sent("POST", "/api/v1/nutrition/parse/label").single().body?.let {
                Regex(""""mimeType":"([^"]+)"""").find(it)?.groupValues?.get(1)
            },
        )

        myFoods.reviewLabel(read)
        val sheet = myFoods.customFood.value!!
        assertEquals("Protein bar", sheet.name)
        assertEquals("450", sheet.calories)
        assertEquals(listOf("Energy converted from kJ."), sheet.label?.warnings)

        myFoods.saveCustomFood(logAfter = true)
        val created = withTimeout(TIMEOUT_MS) { myFoods.toLog.first() }
        assertEquals("f9", created.id)
        val body = api.sent("POST", "/api/v1/nutrition/foods").single().body.orEmpty()
        assertTrue(""""servings":[{"label":"1 bar","grams":40.0}]""" in body, body)
    }

    @Test
    fun aPhotoWithNoLabelSaysSoAndOpensNothing() = runBlocking {
        api.on("POST", "/api/v1/nutrition/parse/label", """{"label":null,"suggestion":null,"warnings":[]}""")
        val capture = capture()

        capture.parseLabel(EncodedImage("abc", "image/jpeg"))

        assertTrue(withTimeout(TIMEOUT_MS) { capture.messages.first() }.startsWith("No nutrition label found"))
        assertEquals(false, capture.state.value.readingLabel)
    }

    @Test
    fun withTheAiOffConsentComesFirstAndTheSamePhotoIsReadAfter() = runBlocking {
        api.on("POST", "/api/v1/nutrition/parse/label", LABEL)
        var enabled = false
        val capture = capture(aiOn = false, enableAi = { enabled = true })

        capture.parseLabel(EncodedImage("abc", "image/jpeg"))
        assertTrue(capture.state.value.consentOpen)
        assertTrue(api.sent("POST", "/api/v1/nutrition/parse/label").isEmpty())

        capture.acceptAi()
        assertEquals("Protein bar", withTimeout(TIMEOUT_MS) { capture.labels.first() }.suggestion?.name)
        assertTrue(enabled)
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L

        const val LABEL =
            """{"label":{"productName":"Protein bar","servingSizeText":"1 bar (40 g)","servingSizeG":40,"basis":"both",""" +
                """"confidence":92},"suggestion":{"name":"Protein bar","caloriesPer100g":450,"proteinPer100g":20,""" +
                """"servingSizeG":40,"servings":[{"label":"1 bar","grams":40}]},"warnings":["Energy converted from kJ."]}"""

        const val CREATED =
            """{"id":"f9","source":"custom","name":"Protein bar","caloriesPer100g":450,"isPublic":false,""" +
                """"createdAt":"2026-11-12T00:00:00Z","updatedAt":"2026-11-12T00:00:00Z"}"""
    }
}
