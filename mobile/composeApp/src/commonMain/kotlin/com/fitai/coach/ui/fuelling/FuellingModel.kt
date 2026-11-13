package com.fitai.coach.ui.fuelling

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.GetNutritionSummaryRangeResponse
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.data.SessionFuelling
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.nutrition.SessionFuellingTargetInput
import com.fitai.coach.core.nutrition.computeSessionFuellingTarget
import com.fitai.coach.ui.format.formatNumber
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** Grams as the web prints them: "30", or "12.5" for a fraction. */
fun grams(value: Double): String = formatNumber(value)

/** "12g to go" when short of the target, "on target" once met (targetLines.tsx gapText). */
fun gapText(remaining: Double?): String = if (remaining != null && remaining > 0) "${grams(remaining)}g to go" else "on target"

/** The line under a planned session's targets, when there's something to say (FuellingPlanPanel.tsx planHint). */
enum class PlanHint(val text: String) {
    NoBodyweight("Set your bodyweight in Settings for targets tailored to you."),
    NoDuration("Add exercises or set an expected duration for a tailored plan."),
    Estimated("Estimated from your planned exercises — adjust below to fine-tune."),
}

/**
 * Which hint a planned session's targets get: without a bodyweight they are
 * general defaults; without a duration, an hour is assumed; with the server's
 * estimate standing in for a saved duration, it says so.
 */
fun planHint(noBodyweight: Boolean, hasDuration: Boolean, usingEstimate: Boolean): PlanHint? = when {
    noBodyweight -> PlanHint.NoBodyweight
    !hasDuration -> PlanHint.NoDuration
    usingEstimate -> PlanHint.Estimated
    else -> null
}

/** "60 min · RPE 7 · at 07:30", what the collapsed "Adjust session estimate" row says it's set to. */
fun adjustSummary(durationMin: Int?, rpe: Int?, timeOfDay: String?): String = listOfNotNull(
    durationMin?.let { "$it min" },
    rpe?.let { "RPE $it" },
    timeOfDay?.takeIf { it.isNotBlank() }?.let { "at $it" },
).joinToString(" · ")

/** The shortest and longest expected session the server takes, in minutes. */
const val MIN_EXPECTED_DURATION = 1
const val MAX_EXPECTED_DURATION = 600

/** A typed or stepped duration held to what the server takes. */
fun clampDuration(minutes: Int): Int = minutes.coerceIn(MIN_EXPECTED_DURATION, MAX_EXPECTED_DURATION)

/**
 * Two edits to a planned session's expected duration, effort and start time
 * as one: each field [next] sets wins, the rest stay as [this] set them. Rapid
 * stepper taps on different fields go out as one PATCH.
 */
fun PatchPlansDaysByDayIdRequest.then(next: PatchPlansDaysByDayIdRequest): PatchPlansDaysByDayIdRequest = copy(
    expectedDurationMin = next.expectedDurationMin.or(expectedDurationMin),
    expectedRpe = next.expectedRpe.or(expectedRpe),
    plannedTimeOfDayMin = next.plannedTimeOfDayMin.or(plannedTimeOfDayMin),
)

private fun <T : Any> Patch<T>.or(earlier: Patch<T>): Patch<T> = if (this is Patch.Value) this else earlier

/**
 * A day's fuelling on the timeline (FuellingDayChip.tsx): calories against
 * the day's target, protein against its own, and whether a post-workout meal
 * was logged. Null on a day with no target and nothing logged.
 */
data class DayFuelling(
    val date: String,
    val calories: Long,
    val caloriesTarget: Long?,
    val protein: Double?,
    val proteinTarget: Double?,
    val postWorkoutLogged: Boolean,
) {
    /** Past the day's calories (a rounded percentage over 100, as computeTargetProgress). */
    val caloriesOver: Boolean get() = caloriesTarget != null && (calories * PERCENT / caloriesTarget.toDouble()).roundToInt() > PERCENT

    /** What a screen reader says for the chip. */
    val description: String get() {
        val protein = if (protein != null && proteinTarget != null) ", ${grams(protein)} of ${grams(proteinTarget)} g protein" else ""
        val post = if (postWorkoutLogged) ", post-workout meal logged" else ""
        return if (caloriesTarget != null) {
            "Fuelling: $calories of $caloriesTarget kcal$protein$post"
        } else {
            "Fuelling: $calories kcal logged$post"
        }
    }

    companion object {
        fun of(day: GetNutritionSummaryRangeResponse.DaysItem): DayFuelling? {
            val target = day.effectiveTarget
            val caloriesTarget = target?.calories?.takeIf { it > 0 }
            val proteinTarget = target?.proteinG?.takeIf { it > 0 }
            val calories = day.totals.calories
            if (caloriesTarget == null && proteinTarget == null && calories <= 0) return null
            return DayFuelling(
                date = day.date,
                calories = calories.roundToLong(),
                caloriesTarget = caloriesTarget?.roundToLong(),
                protein = proteinTarget?.let { day.totals.protein },
                proteinTarget = proteinTarget,
                postWorkoutLogged = day.hasPostWorkoutFuel,
            )
        }
    }
}

private const val PERCENT = 100

/** A span of days, both ends included. */
data class DateRange(val from: String, val to: String)

/** Days a fuelling request snaps out to at each end, so scrolling within a block asks for the same range. */
const val FUELLING_BLOCK_DAYS = 28

// A Monday, so every block runs Monday to Sunday four weeks later.
private const val FUELLING_BLOCK_EPOCH = "2001-01-01"

private fun blockStart(date: String): String {
    val days = dayDiff(FUELLING_BLOCK_EPOCH, date) ?: return date
    return addDaysToIsoDate(FUELLING_BLOCK_EPOCH, days.floorDiv(FUELLING_BLOCK_DAYS) * FUELLING_BLOCK_DAYS)
}

/**
 * [oldest] to [newest] held to the server's span cap
 * ([SessionFuelling.MAX_RANGE_DAYS]): a wider window is narrowed, centred on
 * [today] where it reaches far enough each side, else kept to its nearer end
 * (fuellingWindow.ts fuellingRangeWindow). Days outside get no chip.
 */
fun fuellingRangeWindow(oldest: String, newest: String, today: String): DateRange {
    val cap = SessionFuelling.MAX_RANGE_DAYS
    val span = (dayDiff(oldest, newest) ?: 0) + 1
    if (span <= cap) return DateRange(oldest, newest)
    val centred = (dayDiff(oldest, today) ?: 0) - (cap - 1) / 2
    val from = addDaysToIsoDate(oldest, centred.coerceIn(0, span - cap))
    return DateRange(from, addDaysToIsoDate(from, cap - 1))
}

/**
 * The range the timeline asks for chips over (renderedFuellingWindow): the
 * days with sessions on them, and today, snapped out to whole
 * [FUELLING_BLOCK_DAYS] blocks and held to the server's cap. Days with only
 * a note still get a chip inside the range; they don't stretch it. Null with
 * nothing to show.
 */
fun timelineFuellingWindow(dates: List<String>, today: String): DateRange? {
    val sorted = dates.sorted()
    val oldest = sorted.firstOrNull() ?: return null
    val newest = sorted.last()
    return fuellingRangeWindow(blockStart(oldest), addDaysToIsoDate(blockStart(newest), FUELLING_BLOCK_DAYS - 1), today)
}

/**
 * The fuel plan on a planned session's card (FuellingTargetChip.tsx): carbs
 * before when the session warrants them, and recovery carbs and protein
 * after. Worked out from the athlete's expected duration and effort, else the
 * server's estimate from the prescription (an hour at moderate effort without
 * either), as the session's sheet starts from.
 */
data class FuellingTarget(val preCarbG: Double, val postCarbG: Double, val postProteinG: Double, val explanation: String) {
    val hasPre: Boolean get() = preCarbG > 0
    val hasPost: Boolean get() = postCarbG > 0 || postProteinG > 0

    companion object {
        /** Null off an upcoming planned day, or when the session warrants no target at all. */
        fun of(entry: TimelineEntry, bodyweightKg: Double?): FuellingTarget? {
            if (entry.status != TimelineEntry.Status.Planned || entry.planDayId.isNullOrEmpty()) return null
            val estimate = entry.sessionEstimate
            val target = computeSessionFuellingTarget(
                SessionFuellingTargetInput(
                    durationMin = entry.expectedDurationMin?.toDouble() ?: estimate?.durationMin,
                    rpe = entry.expectedRpe?.toDouble() ?: estimate?.rpe,
                    bodyweightKg = bodyweightKg,
                ),
            )
            return FuellingTarget(target.preCarbG, target.postCarbG, target.postProteinG, target.explanation)
                .takeIf { it.hasPre || it.hasPost }
        }
    }
}
