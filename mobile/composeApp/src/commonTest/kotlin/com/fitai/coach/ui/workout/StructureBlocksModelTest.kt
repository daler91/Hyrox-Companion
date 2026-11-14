package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.ApiJson
import com.fitai.coach.core.api.generated.WorkoutStructureBlock
import com.fitai.coach.core.api.generated.WorkoutStructureBlock.FormatType
import com.fitai.coach.core.structure.BlockScore
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class StructureBlocksModelTest {
    private fun block(
        format: String,
        fields: String = "",
        steps: String = """{"stepNumber":1,"stepType":"work","exerciseName":"burpees"}""",
    ) =
        ApiJson.decodeFromString(
            WorkoutStructureBlock.serializer(),
            """{"id":"b1","sectionType":"main","formatType":"$format"$fields,"score":null,""" +
                """"sequenceOrder":0,"sortOrder":0,"steps":[$steps]}""",
        )

    @Test
    fun eachFormatSaysHowItIsSetUp() {
        assertEquals("12 min", blockSetup(block("emom", ""","durationMinutes":12""")))
        assertEquals("10 min", blockSetup(block("emom", ""","roundCount":10""")))
        assertEquals("15 min cap", blockSetup(block("amrap", ""","timeCapMinutes":15""")))
        assertEquals("3 rounds", blockSetup(block("rounds", ""","roundCount":3""")))
        assertEquals(
            "8 rounds · 0:30 on · 1 min off",
            blockSetup(block("interval", ""","rounds":8,"workIntervalSec":30,"restSeconds":60""")),
        )
        assertEquals("1 round · 20 min cap", blockSetup(block("for_time", ""","rounds":1,"timeCapMinutes":20""")))
        assertEquals("30 min", blockSetup(block("steady", ""","durationSeconds":1800""")))
        assertNull(blockSetup(block("quality")))
    }

    @Test
    fun aStepReadsAsItsMinuteMovementAndTargets() {
        val emom = block(
            "emom",
            steps = """{"stepNumber":1,"minuteIndex":2,"stepType":"work","exerciseName":"wall_balls",""" +
                """"targets":{"targetReps":15,"targetWeight":9,"instructions":"unbroken"}}""",
        )
        assertEquals("Min 2 · Wall Balls · 15 reps · 9 kg · unbroken", stepLine(emom.steps.single(), FormatType.Emom, "kg"))

        val run =
            block("rounds", steps = """{"stepNumber":1,"stepType":"work","exerciseName":"running","targets":{"distance":400,"time":1.5}}""")
        assertEquals("Running · 400 m · 1:30", stepLine(run.steps.single(), FormatType.Rounds, "kg"))

        val rest = block("rounds", steps = """{"stepNumber":2,"stepType":"rest","targets":{"durationSeconds":60}}""")
        assertEquals("Rest · 1:00", stepLine(rest.steps.single(), FormatType.Rounds, "kg"))
    }

    @Test
    fun onlyEmomAmrapAndRoundsTakeAResult() {
        assertTrue(listOf(FormatType.Emom, FormatType.Amrap, FormatType.Rounds).all(::takesResult))
        assertFalse(listOf(FormatType.Interval, FormatType.ForTime, FormatType.Steady, FormatType.Quality).any(::takesResult))
    }

    @Test
    fun aResultReadsInALine() {
        assertEquals("Completed · 12 min · 3 reps missed", scoreSummary(BlockScore.Emom(true, 12, 3)))
        assertEquals("Not completed · 1 rep missed", scoreSummary(BlockScore.Emom(false, missedReps = 1)))
        assertEquals("5 rounds + 12 reps", scoreSummary(BlockScore.Amrap(5, 12)))
        assertEquals("1 round · 8:00", scoreSummary(BlockScore.Rounds(1, 480)))
    }

    @Test
    fun theFormHoldsTheSavedResultAndSavesWhatIsTyped() {
        val saved = BlockScore.Emom(completed = true, completedMinutes = 12, notes = "Strong")
        val form = BlockResultForm.of(FormatType.Emom, saved)
        assertEquals(BlockResultForm(FormatType.Emom, completed = true, first = "12", notes = "Strong"), form)
        assertEquals(saved, form.score())

        // Blank rounds count as none done, as the web reads them.
        assertEquals(BlockScore.Amrap(rounds = 0), BlockResultForm(FormatType.Amrap).score())
        assertEquals(
            BlockScore.Rounds(3, 480, "Hot"),
            BlockResultForm(FormatType.Rounds, first = " 3 ", second = "480", notes = " Hot ").score(),
        )
    }

    @Test
    fun numbersMustBeWholeAndInRange() {
        assertNull(BlockResultForm(FormatType.Amrap, first = "5", second = "12").error())
        assertEquals("Full rounds done must be a whole number from 0 to 10,000.", BlockResultForm(FormatType.Amrap, first = "5.5").error())
        assertEquals("Minutes completed must be a whole number from 0 to 1,440.", BlockResultForm(FormatType.Emom, first = "1500").error())
        assertEquals(
            "Total time (seconds) must be a whole number from 0 to 86,400.",
            BlockResultForm(FormatType.Rounds, second = "-1").error(),
        )
        assertEquals("Notes can be at most 1,000 characters.", BlockResultForm(FormatType.Rounds, notes = "x".repeat(1001)).error())
    }

    @Test
    fun blocksComeInTheOrderTheyWereDone() {
        val later = block("amrap").copy(id = "b2", sequenceOrder = 1)
        val first = block("emom").copy(id = "b1", sequenceOrder = 0, sortOrder = 1)
        val firstOfAll = block("rounds").copy(id = "b0", sequenceOrder = 0, sortOrder = 0)

        assertEquals(listOf("b0", "b1", "b2"), orderedBlocks(listOf(later, first, firstOfAll)).map { it.id })
    }
}
