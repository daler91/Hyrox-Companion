package com.fitai.coach.ui.workout

import com.fitai.coach.core.api.generated.WorkoutStructureBlock
import com.fitai.coach.core.api.generated.WorkoutStructureBlock.FormatType
import com.fitai.coach.core.api.generated.WorkoutStructureBlock.SectionType
import com.fitai.coach.core.api.generated.WorkoutStructureBlock.StepsItem
import com.fitai.coach.core.structure.BlockScore
import com.fitai.coach.ui.format.exerciseLabel
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatWeight
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull

private const val SECONDS_PER_MINUTE = 60
private const val MAX_MINUTES = 1_440
private const val MAX_COUNT = 10_000
private const val MAX_SECONDS = 86_400
private const val MAX_NOTES = 1_000
private const val DIGIT_GROUP = 3

/** The badge on a block: "EMOM", "AMRAP", "Rounds"... */
fun blockFormatLabel(format: FormatType): String = when (format) {
    FormatType.Emom -> "EMOM"
    FormatType.Amrap -> "AMRAP"
    FormatType.Rounds -> "Rounds"
    FormatType.Interval -> "Intervals"
    FormatType.ForTime -> "For time"
    FormatType.Steady -> "Steady"
    FormatType.Quality -> "Quality"
    FormatType.Unknown -> "Block"
}

/** The acronym spelled out, for the formats the web explains (FORMAT_GUIDE). */
fun blockFormatName(format: FormatType): String? = when (format) {
    FormatType.Emom -> "Every Minute On the Minute"
    FormatType.Amrap -> "As Many Rounds As Possible"
    FormatType.Rounds -> "Fixed rounds"
    else -> null
}

/** Which part of the session the block is; null for one this build doesn't know. */
fun blockSectionLabel(section: SectionType): String? = when (section) {
    SectionType.Warmup -> "Warm-up"
    SectionType.Activation -> "Activation"
    SectionType.Main -> "Main"
    SectionType.Accessory -> "Accessory"
    SectionType.Cooldown -> "Cool-down"
    SectionType.Mobility -> "Mobility"
    SectionType.Unknown -> null
}

/** Only these blocks take a result (structureBlockScoreSchema). */
fun takesResult(format: FormatType): Boolean = format == FormatType.Emom || format == FormatType.Amrap || format == FormatType.Rounds

/**
 * How the block is set up: "12 min" for an EMOM, "12 min cap" for an AMRAP,
 * "8 rounds · 0:30 on · 0:30 off" for intervals. Either spelling of a field
 * counts (roundCount or rounds, workSeconds or workIntervalSec).
 */
fun blockSetup(block: WorkoutStructureBlock): String? {
    val length = block.durationMinutes?.let { "$it min" } ?: block.durationSeconds?.let(::secondsLabel)
    val parts = when (block.formatType) {
        FormatType.Emom -> listOfNotNull(length ?: (block.roundCount ?: block.rounds)?.let { "$it min" })
        FormatType.Amrap -> listOfNotNull((block.timeCapMinutes ?: block.durationMinutes)?.let { "$it min cap" })
        else -> repeatedSetup(block) + listOfNotNull(length, block.timeCapMinutes?.let { "$it min cap" })
    }
    return parts.joinToString(" · ").ifEmpty { null }
}

private fun repeatedSetup(block: WorkoutStructureBlock): List<String> = listOfNotNull(
    (block.roundCount ?: block.rounds)?.let { if (it == 1L) "1 round" else "$it rounds" },
    (block.workSeconds ?: block.workIntervalSec)?.let { "${secondsLabel(it)} on" },
    (block.restSeconds ?: block.restIntervalSec)?.let { "${secondsLabel(it)} off" },
)

/** Whole minutes as "12 min", anything else as a clock. */
private fun secondsLabel(seconds: Long): String = if (seconds > 0 && seconds % SECONDS_PER_MINUTE == 0L) {
    "${seconds / SECONDS_PER_MINUTE} min"
} else {
    formatClock(seconds / SECONDS_PER_MINUTE.toDouble())
}

/** One step: "Min 1 · Burpees · 10 reps", "Rest · 1:00". */
fun stepLine(step: StepsItem, format: FormatType, weightUnit: String?): String = buildList {
    if (format == FormatType.Emom) step.minuteIndex?.let { add("Min $it") }
    add(
        when (step.stepType) {
            StepsItem.StepType.Rest -> "Rest"
            StepsItem.StepType.Transition -> "Transition"
            else -> exerciseLabel(step.exerciseName ?: "custom", step.customLabel)
        },
    )
    addAll(targetParts(step.targets.orEmpty(), weightUnit))
}.joinToString(" · ")

/** Reps, distance (metres), weight, time (minutes) and duration (seconds), then any written target. */
private fun targetParts(targets: Map<String, JsonElement?>, weightUnit: String?): List<String> {
    fun number(vararg keys: String) = keys.firstNotNullOfOrNull { key ->
        (targets[key] as? JsonPrimitive)?.takeUnless { it.isString }?.doubleOrNull
    }
    return listOfNotNull(
        number("targetReps", "reps")?.let { "${formatNumber(it)} reps" },
        number("targetDistance", "distance")?.let { "${formatNumber(it)} m" },
        number("targetWeight", "weight")?.let { formatWeight(it, weightUnit) },
        number("targetTime", "time")?.let(::formatClock),
        number("durationSeconds")?.let { formatClock(it / SECONDS_PER_MINUTE) },
        (targets["instructions"] as? JsonPrimitive)?.takeIf { it.isString }?.content?.takeIf { it.isNotBlank() },
    )
}

/** A recorded result in a line: "Completed · 12 min · 3 reps missed", "5 rounds + 12 reps". */
fun scoreSummary(score: BlockScore): String = when (score) {
    is BlockScore.Emom -> listOfNotNull(
        if (score.completed) "Completed" else "Not completed",
        score.completedMinutes?.let { "$it min" },
        score.missedReps?.let { if (it == 1) "1 rep missed" else "$it reps missed" },
    )
    is BlockScore.Amrap -> listOfNotNull(roundsLabel(score.rounds) + (score.reps?.let { " + $it reps" } ?: ""))
    is BlockScore.Rounds -> listOfNotNull(
        roundsLabel(score.completedRounds),
        score.elapsedSeconds?.let { formatClock(it / SECONDS_PER_MINUTE.toDouble()) },
    )
}.joinToString(" · ")

private fun roundsLabel(rounds: Int) = if (rounds == 1) "1 round" else "$rounds rounds"

/** A number box on the result form: its label, example and the most it takes. */
data class ResultField(val label: String, val placeholder: String, val max: Int)

/** The two numbers each kind of block records, in the web's words (ResultControls). */
fun resultFields(format: FormatType): Pair<ResultField, ResultField> = when (format) {
    FormatType.Emom -> ResultField("Minutes completed", "e.g. 10", MAX_MINUTES) to ResultField("Reps missed", "e.g. 0", MAX_COUNT)
    FormatType.Amrap ->
        ResultField("Full rounds done", "e.g. 5", MAX_COUNT) to ResultField("Extra reps in last round", "e.g. 12", MAX_COUNT)
    else -> ResultField("Rounds completed", "e.g. 3", MAX_COUNT) to ResultField("Total time (seconds)", "e.g. 480", MAX_SECONDS)
}

/**
 * The result form as typed: [first] and [second] are the block's two numbers
 * ([resultFields]); [completed] is an EMOM's "Finished it".
 */
data class BlockResultForm(
    val format: FormatType,
    val completed: Boolean = false,
    val first: String = "",
    val second: String = "",
    val notes: String = "",
) {
    /** The first thing wrong with what's typed; null when it can be saved. */
    fun error(): String? {
        val (one, two) = resultFields(format)
        val notesTooLong = notes.trim().length > MAX_NOTES
        return countError(first, one) ?: countError(second, two) ?: if (notesTooLong) "Notes can be at most 1,000 characters." else null
    }

    /** The result to save. Blank rounds count as none done, as the web reads them. Check [error] first. */
    fun score(): BlockScore {
        val one = count(first)
        val two = count(second)
        val note = notes.trim().ifEmpty { null }
        return when (format) {
            FormatType.Emom -> BlockScore.Emom(completed, one, two, note)
            FormatType.Amrap -> BlockScore.Amrap(one ?: 0, two, note)
            else -> BlockScore.Rounds(one ?: 0, two, note)
        }
    }

    companion object {
        /** The form for a block of [format], holding the result it has. */
        fun of(format: FormatType, saved: BlockScore?): BlockResultForm {
            val (one, two) = when (saved) {
                is BlockScore.Emom -> saved.completedMinutes to saved.missedReps
                is BlockScore.Amrap -> saved.rounds to saved.reps
                is BlockScore.Rounds -> saved.completedRounds to saved.elapsedSeconds
                null -> null to null
            }
            return BlockResultForm(
                format = format,
                completed = (saved as? BlockScore.Emom)?.completed ?: false,
                first = one?.toString().orEmpty(),
                second = two?.toString().orEmpty(),
                notes = saved?.notes.orEmpty(),
            )
        }
    }
}

private fun count(text: String): Int? = text.trim().toIntOrNull()

private fun countError(text: String, field: ResultField): String? {
    val value = count(text)
    val wrong = text.isNotBlank() && (value == null || value !in 0..field.max)
    return if (wrong) "${field.label} must be a whole number from 0 to ${grouped(field.max)}." else null
}

/** 10000 as "10,000". */
private fun grouped(number: Int): String = number.toString().reversed().chunked(DIGIT_GROUP).joinToString(",").reversed()
