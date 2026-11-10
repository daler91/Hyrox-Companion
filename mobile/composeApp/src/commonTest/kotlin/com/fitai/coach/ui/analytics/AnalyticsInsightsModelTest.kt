package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.ApiException
import com.fitai.coach.core.api.generated.RacePrediction
import com.fitai.coach.core.api.generated.RacePredictionConfidence
import com.fitai.coach.core.api.generated.SessionGradeRollupCounts
import com.fitai.coach.core.api.generated.SessionGradeRunPurpose
import com.fitai.coach.core.api.generated.SessionGradeTrainingPhase
import com.fitai.coach.core.api.generated.SessionGradeVerdictCounts
import com.fitai.coach.core.api.generated.SessionGradesResponse
import com.fitai.coach.ui.components.BadgeTone
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class AnalyticsInsightsModelTest {
    private fun prediction(
        percentile: RacePrediction.Percentile? = null,
        stations: Long = 6,
        hasRunData: Boolean = true,
        gender: RacePrediction.Gender? = RacePrediction.Gender.Female,
    ) = RacePrediction(
        totalFinishSeconds = 5025.4,
        segments = emptyList(),
        transitionSeconds = 300.0,
        aiUsed = false,
        overallConfidence = RacePredictionConfidence.Medium,
        division = RacePrediction.Division.Pro,
        gender = gender,
        genderAssumed = false,
        ageGroup = "30-34",
        ageGroupAssumed = false,
        percentile = percentile,
        dataCompleteness = RacePrediction.DataCompleteness(stations, 8, hasRunData),
        generatedAt = "2026-11-10T09:30:00Z",
        stale = false,
    )

    private fun verdicts(
        onTarget: Long = 0,
        creptUp: Long = 0,
        tooHard: Long = 0,
        drifted: Long = 0,
        under: Long = 0,
        inconclusive: Long = 0,
    ) = SessionGradeVerdictCounts(onTarget, creptUp, tooHard, drifted, under, inconclusive, ungradeable = 0)

    private fun counts(easy: SessionGradeVerdictCounts, threshold: SessionGradeVerdictCounts) = SessionGradeRollupCounts(
        easy = easy,
        threshold = threshold,
        graded = 0,
        onTarget = 0,
        driftedHarder = 0,
        easyTooHard = 0,
        ungradeable = 0,
        pending = 0,
        plannedGradeable = 0,
    )

    @Test
    fun aRaceReadsAsHoursAndASplitAsMinutes() {
        assertEquals("1:23:45", formatFinishTime(5025.4))
        assertEquals("0:59:59", formatFinishTime(3599.4))
        assertEquals("4:05", formatSplit(245.0))
        assertEquals("0:00", formatSplit(-3.0))
    }

    @Test
    fun thePredictionSaysWhoItsForAndWhatItRestsOn() {
        assertEquals("Pro · Women · 30-34 · 6/8 stations logged", predictionSubtitle(prediction()))
        assertEquals("Pro · Unspecified · 30-34 · 6/8 stations logged", predictionSubtitle(prediction(gender = null)))
        assertEquals("Medium confidence" to BadgeTone.Warning, confidenceBadge(RacePredictionConfidence.Medium))
    }

    @Test
    fun thePercentileNamesTheCohortAndItsSize() {
        val cohort = RacePrediction.Percentile(62.0, "women 30-34", 12045, RacePrediction.Percentile.Basis.AgeGroup)
        assertEquals("Faster than 62% of women 30-34 · 12,045 athletes", percentileLine(prediction(percentile = cohort)))
        assertNull(percentileLine(prediction()))
    }

    @Test
    fun withNothingLoggedThereIsNoPrediction() {
        assertTrue(hasNoRaceData(prediction(stations = 0, hasRunData = false)))
        assertEquals(false, hasNoRaceData(prediction(stations = 0, hasRunData = true)))
    }

    @Test
    fun readinessReadsAsAWordAndASignedForm() {
        assertEquals("Race-ready" to BadgeTone.Accent, readinessBadge(RacePrediction.RaceReadiness.Status.Neutral))
        assertEquals("Very fatigued" to BadgeTone.Danger, readinessBadge(RacePrediction.RaceReadiness.Status.VeryFatigued))
        assertEquals("+12", formatTsb(12.0))
        assertEquals("-8", formatTsb(-8.0))
        assertEquals("0", formatTsb(0.0))
    }

    @Test
    fun theAiNoticeSaysWhyThereWasNoAi() {
        assertTrue(aiNotice(RacePrediction.AiUnavailableReason.AiConsentOff).contains("Enable the AI Coach"))
        assertTrue(aiNotice(RacePrediction.AiUnavailableReason.AiBudgetExceeded).contains("today's AI usage limit"))
        assertEquals("This is a baseline estimate from your logged data.", aiNotice(null))
    }

    @Test
    fun theLastUpdatedLineSaysWhenNewActivityMakesItStale() {
        assertEquals("Last updated Nov 10, 2026 at 9:30 AM.", lastUpdatedNote("Nov 10, 2026 at 9:30 AM", stale = false))
        assertEquals(
            "Last updated Nov 10, 2026 at 9:30 AM. New activity since — refresh to update.",
            lastUpdatedNote("Nov 10, 2026 at 9:30 AM", stale = true),
        )
        assertNull(lastUpdatedNote(null, stale = true))
    }

    @Test
    fun onlyDefiniteVerdictsCountTowardTheShare() {
        val rollup = counts(easy = verdicts(onTarget = 3, creptUp = 1, inconclusive = 2), threshold = verdicts())
        assertEquals(Share(3, 4), easyShare(rollup))
        assertEquals("75%", formatShare(easyShare(rollup)))
        assertEquals("3 of 4 (75%)", shareCell(easyShare(rollup)))
        assertEquals("—", formatShare(thresholdShare(rollup)))
        assertEquals("—", shareCell(thresholdShare(rollup)))
    }

    @Test
    fun aWeeksRunsFallIntoFourStacks() {
        val rollup =
            counts(
                easy = verdicts(onTarget = 2, creptUp = 1, tooHard = 1, inconclusive = 1),
                threshold = verdicts(onTarget = 1, drifted = 2, under = 1),
            )
        assertEquals(GradeStack(onTarget = 3, partial = 2, missed = 3, unclear = 1), gradeStack(rollup))
        assertEquals(9, gradeStack(rollup).total)
    }

    @Test
    fun phasesPurposesAndBlocksReadAsTheWebWritesThem() {
        assertEquals("Race week", phaseLabel(SessionGradeTrainingPhase.RaceWeek))
        assertEquals("Build", phaseLabel(SessionGradeTrainingPhase.Build))
        assertNull(phaseLabel(null))
        assertEquals("Race effort", purposeLabel(SessionGradeRunPurpose.Race))
        val block = SessionGradesResponse.BlocksItem(
            2,
            5,
            8,
            listOf(SessionGradeTrainingPhase.Build),
            includesDeload = true,
            counts = counts(verdicts(), verdicts()),
        )
        assertEquals("Weeks 5–8 · deload", blockSpan(block))
        assertEquals("Week 5", blockSpan(block.copy(lastWeek = 5, includesDeload = false)))
    }

    @Test
    fun aiFailuresAreExplainedInTheAthletesTerms() {
        val fallback = "Sorry"
        assertTrue(describeAiFailure(ApiException(403, "AI_COACH_DISABLED", "off"), "requesting insights", fallback).contains("turned off"))
        assertEquals(
            "You've reached your daily AI usage limit. Please try again later.",
            describeAiFailure(ApiException(429, "AI_BUDGET_EXCEEDED", "limit"), "requesting insights", fallback),
        )
        assertEquals(
            "You're requesting insights too quickly. Please wait a moment and try again.",
            describeAiFailure(ApiException(429, "RATE_LIMITED", "slow down"), "requesting insights", fallback),
        )
        assertEquals(fallback, describeAiFailure(ApiException(500, null, "boom"), "requesting insights", fallback))
        assertEquals(fallback, describeAiFailure(IllegalStateException(), "requesting insights", fallback))
    }
}
