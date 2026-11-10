package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.TrainingOverview.CategoryTotalsValue
import com.fitai.coach.core.api.generated.TrainingOverview.MovementPatternCoverageItem
import com.fitai.coach.core.api.generated.TrainingOverview.MovementPatternCoverageItem.Pattern
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.BodyRegion
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.Muscle
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BreakdownModelTest {
    private fun pattern(p: Pattern, label: String, sessions: Long, sets: Long, daysSince: Long?) =
        MovementPatternCoverageItem(p, label, sessions, sets, lastTrained = daysSince?.let { "2026-11-01" }, daysSince = daysSince)

    private fun muscle(m: Muscle, region: BodyRegion, label: String, sets: Long, daysSince: Long?) =
        MuscleGroupCoverageItem(
            m,
            region,
            label,
            sessionCount = if (sets >
                0
            ) {
                1
            } else {
                0
            },
            totalSets = sets,
            lastTrained = daysSince?.let { "2026-11-01" },
            daysSince = daysSince,
        )

    @Test
    fun theMixListsCategoriesWithSessionsLargestFirst() {
        val slices = categorySlices(
            mapOf(
                "running" to CategoryTotalsValue(1, 0),
                "functional" to CategoryTotalsValue(3, 20),
                "strength" to CategoryTotalsValue(0, 0),
            ),
        )
        assertEquals(listOf(CategorySlice("functional", "Functional", 3, 75), CategorySlice("running", "Running", 1, 25)), slices)
    }

    @Test
    fun freshnessReadsInDaysAndGoesRedAfterTwoWeeks() {
        assertEquals("Today", freshnessLabel(0))
        assertEquals("Yesterday", freshnessLabel(1))
        assertEquals("9d ago", freshnessLabel(9))
        assertEquals("Never trained", freshnessLabel(null))
        assertEquals(CoverageTone.Good, freshnessTone(7))
        assertEquals(CoverageTone.Watch, freshnessTone(14))
        assertEquals(CoverageTone.Gap, freshnessTone(15))
        assertEquals(CoverageTone.Gap, freshnessTone(null))
    }

    @Test
    fun aBalanceSaysWhichSideLeadsAndWhatToAdd() {
        assertEquals(CoverageTone.Good, balance("Push / Pull", "Push", 10, "pull", 8).tone)
        val pushHeavy = balance("Push / Pull", "Push", 16, "pull", 10)
        assertEquals("16 sets / 10 sets", pushHeavy.value)
        assertEquals(CoverageTone.Watch, pushHeavy.tone)
        assertEquals("Add pull work before more push volume.", pushHeavy.recommendation)
        assertEquals("pull volume is leading push volume.", balance("Push / Pull", "Push", 6, "pull", 10).detail)
        assertEquals("Missing push volume.", balance("Push / Pull", "Push", 0, "pull", 4).detail)
        assertEquals("Add push and pull exposure before judging this balance.", balance("Push / Pull", "Push", 0, "pull", 0).recommendation)
        assertNull(balance("Push / Pull", "Push", 10, "pull", 10).recommendation)
    }

    @Test
    fun theFirstNeverTrainedPatternIsTheGapBeforeAnyStaleOne() {
        val patterns = listOf(
            pattern(Pattern.Squat, "Squat", 3, 12, 2),
            pattern(Pattern.Hinge, "Hinge", 1, 4, 20),
            pattern(Pattern.Carry, "Carry", 0, 0, null),
        )
        val analysis = movementPatternAnalysis(patterns)

        assertEquals(
            CoverageMetric("Coverage", "2/3", "67% of movement patterns trained in this range.", CoverageTone.Watch),
            analysis.metrics[0],
        )
        assertEquals("Squat", analysis.metrics[1].value)
        assertEquals("Carry", analysis.metrics[2].value)
        assertEquals("Next focus: Add Carry; it has no logged sessions in this range.", analysis.nextFocus)
        assertEquals(16, analysis.totalSets)
    }

    @Test
    fun withEverythingTrainedTheStalestBeyondTwoWeeksIsTheGap() {
        val gap = priorityGap(
            listOf(pattern(Pattern.Squat, "Squat", 3, 12, 2), pattern(Pattern.Hinge, "Hinge", 1, 4, 20)).map { it.coverage() },
            "never",
        )
        assertEquals("Hinge" to "last trained 20d ago", gap?.first?.label to gap?.second)
        assertNull(priorityGap(listOf(pattern(Pattern.Squat, "Squat", 3, 12, 2)).map { it.coverage() }, "never"))
    }

    @Test
    fun theMuscleMapReadsTheRegionMixAndCoreFreshness() {
        val muscles = listOf(
            muscle(Muscle.Quads, BodyRegion.Lower, "Quads", 12, 1),
            muscle(Muscle.Chest, BodyRegion.Upper, "Chest", 6, 3),
            muscle(Muscle.Core, BodyRegion.Core, "Core", 2, 20),
            muscle(Muscle.Obliques, BodyRegion.Core, "Obliques", 0, null),
        )
        val analysis = muscleAnalysis(muscles)

        assertEquals("Lower body 60%", analysis.metrics[0].value)
        assertEquals("Upper 30% / Core 10% / Lower 60% by set volume.", analysis.metrics[0].detail)
        assertEquals("Quads", analysis.metrics[1].value)
        assertEquals("Obliques", analysis.metrics[2].value)
        assertEquals(
            CoverageMetric("Core freshness", "20d ago", "Core is freshest; 2 core areas need attention.", CoverageTone.Watch),
            analysis.metrics[3],
        )
    }

    @Test
    fun heatLevelsGoByQuarterOfTheMostLoadedMuscle() {
        assertEquals(listOf(0, 1, 2, 3, 4), listOf(0L, 5L, 10L, 15L, 20L).map { heatLevel(it, 20) })
        assertEquals(0, heatLevel(5, 0))
    }
}
