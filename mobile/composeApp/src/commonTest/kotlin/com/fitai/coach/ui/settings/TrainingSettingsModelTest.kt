package com.fitai.coach.ui.settings

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.api.generated.UpdateUserPreferences.MafCategory
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TrainingSettingsModelTest {
    private fun prefs(json: String) = ApiJson.decodeFromString(
        PreferencesResponse.serializer(),
        """{"userTimezone":"UTC","onboardingCompleted":true,$json}""",
    )

    private fun UpdateUserPreferences.json(): JsonObject = ApiJson.encodeToJsonElement(UpdateUserPreferences.serializer(), this).jsonObject

    @Test
    fun valuesOutOfRangeSayTheRangeInTheUnitsShown() {
        assertNull(fieldError("", PreferenceBounds.RestingHr, "Resting heart rate", "bpm"))
        assertEquals(
            "Resting heart rate must be at least 30 bpm.",
            fieldError("25", PreferenceBounds.RestingHr, "Resting heart rate", "bpm"),
        )
        assertEquals("Max heart rate must be 230 bpm or less.", fieldError("231", PreferenceBounds.MaxHr, "Max heart rate", "bpm"))
        assertEquals(
            "Functional threshold power must be a whole number.",
            fieldError("250.5", PreferenceBounds.Ftp, "Functional threshold power", "W"),
        )
        assertEquals("Age must be a number.", fieldError("forty", PreferenceBounds.Age, "Age"))

        // Weights are checked in kilograms but described in the athlete's unit.
        val body = BodyForm.from(prefs(""""weightUnit":"lbs"""")).copy(weight = "1200", goal = "lose", rate = "5")
        assertEquals("Bodyweight must be 1102.3 lbs or less.", body.weightError)
        assertEquals("Weekly rate must be 4.4 lbs or less.", body.rateError)
        assertTrue(body.hasErrors)
        // The rate only counts while losing or gaining.
        assertFalse(body.copy(weight = "180", goal = "maintain").hasErrors)
    }

    @Test
    fun aCardSendsOnlyWhatChangedInKilogramsAndCentimetres() {
        val saved = BodyForm.from(prefs(""""weightUnit":"lbs","bodyweightKg":80,"heightCm":180.34,"activityLevel":"active""""))
        assertEquals("176.4", saved.weight)
        assertEquals("5" to "11", saved.heightFt to saved.heightIn)

        val patch = saved.copy(weight = "", heightIn = "10", goal = "gain").patch(saved).json()
        assertEquals("null", patch["bodyweightKg"].toString())
        assertEquals(177.8, patch["heightCm"].toString().toDouble(), 0.01)
        assertEquals("\"gain\"", patch["weightGoalDirection"].toString())
        assertNull(patch["activityLevel"])
        assertNull(patch["weightGoalRateKgPerWeek"])

        val heart = HeartForm.from(prefs(""""restingHr":52"""))
        val heartPatch = heart.copy(restingHr = "", maxHr = "188").patch(heart).json()
        assertEquals("null", heartPatch["restingHr"].toString())
        assertEquals("188", heartPatch["maxHr"].toString())
        assertNull(heartPatch["ftp"])

        val race = RaceProfileForm.from(prefs(""""division":"open","age":34"""))
        val racePatch = race.copy(division = "pro").patch(race).json()
        assertEquals("\"pro\"", racePatch["division"].toString())
        assertNull(racePatch["age"])
    }

    @Test
    fun theMafCeilingIs180MinusAgeMovedByTheCategory() {
        assertEquals(140, mafCeiling(40, MafCategory.ConsistentUpTo2y))
        assertEquals(130, mafCeiling(40, MafCategory.RecoveringOrMedicated))
        assertEquals(135, mafCeiling(40, MafCategory.TrainingInterrupted))
        assertEquals(145, mafCeiling(40, MafCategory.Consistent2yPlusImproving))

        assertEquals("Enter a valid age and select your category.", MafSetup("15", MafCategory.ConsistentUpTo2y, null).error)
        assertEquals("Enter a valid age and select your category.", MafSetup("40", null, null).error)
        val answers = assertNotNull(MafSetup("40", MafCategory.TrainingInterrupted, true).patch()).json()
        assertEquals("135", answers["mafHr"].toString())
        assertEquals("\"training_interrupted\"", answers["mafCategory"].toString())
        assertEquals("true", answers["mafHrDataAvailable"].toString())
    }

    @Test
    fun aStyleSwitchSaysWhereFromAndAsksForARefresh() {
        val toMaf = styleSwitchPatch(
            BALANCED_STYLE,
            MAF_STYLE,
            "2026-11-13T19:00:00Z",
            "2026-11-20T19:00:00Z",
            MafSetup("40", MafCategory.ConsistentUpTo2y, null).patch(),
        ).json()
        assertEquals("\"maf_method\"", toMaf["trainingStyleId"].toString())
        assertEquals("\"balanced_default\"", toMaf["trainingStylePreviousId"].toString())
        assertEquals("true", toMaf["trainingStyleRecomputeNow"].toString())
        assertEquals("\"2026-11-20T19:00:00Z\"", toMaf["mafBaselineTestScheduledAt"].toString())
        assertEquals("140", toMaf["mafHr"].toString())

        val toBalanced = styleSwitchPatch(MAF_STYLE, BALANCED_STYLE, "2026-11-13T19:00:00Z", "2026-11-20T19:00:00Z", null).json()
        assertNull(toBalanced["mafBaselineTestScheduledAt"])
        assertNull(toBalanced["mafHr"])
        assertEquals(4, recalculationSummary(MAF_STYLE).size)
        assertEquals(3, recalculationSummary(BALANCED_STYLE).size)
        assertFalse(hasMafSetup(prefs(""""mafAge":40""")))
        assertTrue(hasMafSetup(prefs(""""mafAge":40,"mafCategory":"consistent_up_to_2y"""")))
    }
}
