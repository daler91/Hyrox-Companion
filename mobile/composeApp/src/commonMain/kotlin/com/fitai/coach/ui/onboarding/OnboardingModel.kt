package com.fitai.coach.ui.onboarding

import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest
import com.fitai.coach.core.api.generated.PostPlansGenerateRequest.ExperienceLevel
import com.fitai.coach.core.api.generated.PreferencesResponse
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.api.generated.UpdateUserPreferences
import com.fitai.coach.core.dates.MAX_PLAN_WEEKS
import com.fitai.coach.core.dates.MIN_PLAN_WEEKS
import com.fitai.coach.core.dates.PLAN_WEEKDAYS
import com.fitai.coach.core.dates.addDaysToIsoDate
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.dates.isIsoCalendarDate
import com.fitai.coach.core.dates.nextPlanStartDate
import com.fitai.coach.core.dates.planSpanWeeks
import com.fitai.coach.core.dates.weekOneDaysBeforeStart
import com.fitai.coach.core.dates.weekdayName

// Setup's content and rules, as the web's onboarding (onboardingGoals.ts,
// GoalStep.tsx, useOnboardingWizard.ts, planStart.ts) and its AI plan form
// (useGeneratePlanForm.ts) have them.

data class OnboardingGoal(val id: String, val label: String, val description: String)

val ONBOARDING_GOALS: List<OnboardingGoal> = listOf(
    OnboardingGoal("strength", "Build strength", "Get stronger with progressive resistance training"),
    OnboardingGoal("endurance", "Improve endurance", "Train for races or improve cardio fitness"),
    OnboardingGoal("functional", "Functional fitness", "Hyrox, CrossFit, or general functional training"),
    OnboardingGoal("weight_loss", "Lose weight", "Combine training with body composition goals"),
    OnboardingGoal("fitness", "General fitness", "Overall health and well-being"),
)

const val DEFAULT_GOAL_ID = "functional"

private val GOAL_SENTENCES = mapOf(
    "strength" to "Get stronger for HYROX: heavier sled push and pull, and steadier lunges and wall balls",
    "endurance" to "Build my running endurance for HYROX's eight 1 km runs",
    "weight_loss" to "Lose weight while building HYROX fitness",
    "fitness" to "Build all-round fitness with HYROX-style training",
)

/** The picked goal as a sentence the plan generator and the coach can act on; a race date is part of it. */
fun describeOnboardingGoal(goalId: String, division: String?, raceDate: String?): String {
    val sentence = GOAL_SENTENCES[goalId] ?: "Complete HYROX ${if (division == "pro") "Pro" else "Open"} feeling strong on every station"
    return if (raceDate.isNullOrEmpty()) sentence else "$sentence, racing on $raceDate"
}

/** Why the optional race date can't be used, or null when it can (blank, or today or later). */
fun raceDateError(raceDate: String, today: String): String? = when {
    raceDate.isEmpty() -> null
    !isIsoCalendarDate(raceDate) -> "That isn't a real date. Check the year, or leave it blank."
    raceDate < today -> "That date has passed. Pick today or later, or leave it blank."
    else -> null
}

private val AGE_RANGE = 13..100

/** The optional age: blank, or a whole number the server accepts. */
fun ageError(value: String): String? {
    if (value.isBlank()) return null
    val age = value.trim().toIntOrNull()
    return if (age != null && age in AGE_RANGE) null else "Enter a whole number between 13 and 100, or leave it blank."
}

/** "Monday and Tuesday", "Monday to Wednesday" (shared/dateUtils describeWeekdaySpan). */
fun describeWeekdaySpan(days: List<String>): String = when (days.size) {
    0, 1 -> days.joinToString("")
    2 -> "${days[0]} and ${days[1]}"
    else -> "${days.first()} to ${days.last()}"
}

/** What a midweek start does to week 1 of the template: its earlier sessions are left off. Null for a Monday. */
fun weekOneStartNote(startDate: String): String? {
    val before = weekOneDaysBeforeStart(startDate)
    if (before.isEmpty()) return null
    return "Plans run Monday to Sunday, so starting on a ${weekdayName(startDate)} leaves week 1's " +
        "${describeWeekdaySpan(before)} sessions off your calendar. Pick a Monday to keep them."
}

/** The same for an AI plan, which plans those days as rest instead. */
fun aiWeekOneStartNote(startDate: String): String? {
    val before = weekOneDaysBeforeStart(startDate)
    if (before.isEmpty()) return null
    return "Week 1 starts on a ${weekdayName(startDate)}, so the plan keeps ${describeWeekdaySpan(before)} of that week as rest."
}

const val DEFAULT_PLAN_WEEKS = 8
const val MIN_DAYS_PER_WEEK = 2
const val MAX_DAYS_PER_WEEK = 7
const val DEFAULT_DAYS_PER_WEEK = 5
private const val DAYS_IN_WEEK = 7

val DEFAULT_REST_DAYS: Map<Int, List<String>> = mapOf(
    7 to emptyList(),
    6 to listOf("Sunday"),
    5 to listOf("Saturday", "Sunday"),
    4 to listOf("Wednesday", "Saturday", "Sunday"),
    3 to listOf("Tuesday", "Thursday", "Saturday", "Sunday"),
    2 to listOf("Monday", "Wednesday", "Friday", "Saturday", "Sunday"),
)

data class FocusOption(val value: String, val label: String)

val FOCUS_OPTIONS: List<FocusOption> = listOf(
    FocusOption("running", "Running"),
    FocusOption("sled_push", "Sled Push"),
    FocusOption("sled_pull", "Sled Pull"),
    FocusOption("skierg", "SkiErg"),
    FocusOption("rowing", "Rowing"),
    FocusOption("wall_balls", "Wall Balls"),
    FocusOption("farmers_carry", "Farmers Carry"),
    FocusOption("burpee_broad_jump", "Burpee Broad Jumps"),
    FocusOption("strength", "Strength"),
    FocusOption("conditioning", "Conditioning"),
)

/**
 * Why a plan's dates can't be used, or null for a 1–24 week plan. The weeks
 * are counted unclamped, as the server counts them: a race date runs through
 * race week.
 */
fun planDateError(startDate: String, endDate: String, endDateIsRaceDate: Boolean): String? {
    val span = if (startDate.isEmpty() || endDate.isEmpty()) null else dayDiff(startDate, endDate)
    val weeks = span?.takeIf { it > 0 }?.let { planSpanWeeks(startDate, endDate, endDateIsRaceDate) }
    return when {
        span == null -> "Start and end dates are required."
        span <= 0 -> "End date must be after the start date."
        weeks == null -> "Start and end dates are required."
        weeks < MIN_PLAN_WEEKS || weeks > MAX_PLAN_WEEKS -> {
            val counted = if (endDateIsRaceDate) "your plan runs $weeks weeks to the end of race week" else "your dates span $weeks weeks"
            "Plan length must be between $MIN_PLAN_WEEKS and $MAX_PLAN_WEEKS weeks ($counted)."
        }
        else -> null
    }
}

/** The longest goal, and injuries note, the server takes. */
const val MAX_PLAN_TEXT = 500

/** The most plans one generation can archive. */
const val MAX_SUPERSEDED_PLANS = 5

/**
 * Live plans whose days overlap [startDate]..[endDate] and still have
 * training left (findOverlappingPlans): the plans the athlete is switching
 * away from. Ended, archived and unscheduled plans are left alone. ISO dates
 * compare as strings.
 */
fun findOverlappingPlans(plans: List<TrainingPlan>, startDate: String, endDate: String, today: String): List<TrainingPlan> {
    if (startDate.isEmpty() || endDate.isEmpty()) return emptyList()
    return plans.filter { plan ->
        val start = plan.startDate
        val end = plan.endDate
        plan.retiredOn == null && start != null && end != null && end >= today && start <= endDate && end >= startDate
    }
}

/** The AI plan form: one screen on the phone for the web dialog's three steps. */
data class PlanForm(
    val goal: String,
    val daysPerWeek: Int,
    val experience: ExperienceLevel,
    val startDate: String,
    val endDate: String,
    val endDateIsRaceDate: Boolean,
    val restDays: List<String>,
    val focusAreas: List<String> = emptyList(),
    val injuries: String = "",
    /** The box started with the older free-text note, so it is always sent: clearing it drops the note. */
    val clearsNote: Boolean = false,
    /** Overlapping plans the athlete chose to keep; the rest are archived once the new plan is ready. */
    val keptPlanIds: Set<String> = emptySet(),
) {
    val requiredRestDays: Int get() = DAYS_IN_WEEK - daysPerWeek
    val dateError: String? get() = planDateError(startDate, endDate, endDateIsRaceDate)
    val hasRestDays: Boolean get() = daysPerWeek == MAX_DAYS_PER_WEEK || restDays.size == requiredRestDays
    val canGenerate: Boolean get() = goal.isNotBlank() && hasRestDays && dateError == null

    /** A new count resets the rest days to that count's usual ones. */
    fun withDaysPerWeek(days: Int): PlanForm {
        val clamped = days.coerceIn(MIN_DAYS_PER_WEEK, MAX_DAYS_PER_WEEK)
        return copy(daysPerWeek = clamped, restDays = DEFAULT_REST_DAYS[clamped].orEmpty())
    }

    /** Adds or removes a rest day; never more than the count leaves. */
    fun toggleRestDay(day: String): PlanForm = when {
        day in restDays -> copy(restDays = restDays - day)
        restDays.size < requiredRestDays -> copy(restDays = (restDays + day).sortedBy(PLAN_WEEKDAYS::indexOf))
        else -> this
    }

    fun toggleFocus(value: String): PlanForm = copy(focusAreas = if (value in focusAreas) focusAreas - value else focusAreas + value)

    /** Archive or keep an overlapping plan. Archiving is the default: switching is why the athlete is here. */
    fun toggleSupersede(planId: String): PlanForm = copy(
        keptPlanIds = if (planId in
            keptPlanIds
        ) {
            keptPlanIds - planId
        } else {
            keptPlanIds + planId
        },
    )

    /** Of the plans this one overlaps, those to archive. */
    fun supersedeIds(overlapping: List<TrainingPlan>): List<String> =
        overlapping.map { it.id }.filterNot { it in keptPlanIds }.take(MAX_SUPERSEDED_PLANS)

    /**
     * The request. endDateIsRaceDate is always sent, so the server never
     * guesses. The server moves the injuries box onto the athlete card, and
     * an empty one drops the older note: so it goes when filled in, or when
     * it started with that note ([clearsNote]). The plans to archive go only
     * when there are some.
     */
    fun toRequest(supersedePlanIds: List<String> = emptyList()): PostPlansGenerateRequest = PostPlansGenerateRequest(
        goal = goal.trim(),
        daysPerWeek = daysPerWeek.toDouble(),
        experienceLevel = experience,
        startDate = startDate,
        endDate = endDate,
        endDateIsRaceDate = endDateIsRaceDate,
        restDays = restDays.takeIf { daysPerWeek < MAX_DAYS_PER_WEEK && it.isNotEmpty() }
            ?.map { day -> PostPlansGenerateRequest.RestDaysItem.entries.first { it.wireValue == day } },
        focusAreas = focusAreas.takeIf { it.isNotEmpty() },
        injuries = injuries.trim().takeIf { it.isNotEmpty() || clearsNote },
        supersedePlanIds = supersedePlanIds.takeIf { it.isNotEmpty() },
    )

    /**
     * Prefills the injuries box with the older free-text note, while the
     * athlete still has one: generating moves the box onto the athlete card
     * and drops the note, so clearing the box forgets it.
     */
    fun withRememberedNote(note: String?): PlanForm {
        val text = note?.trim().orEmpty()
        return if (text.isEmpty()) this else copy(injuries = text.take(MAX_PLAN_TEXT), clearsNote = true)
    }

    companion object {
        /** Starts on the next Monday (today when it is one) and runs 8 weeks, or to the race. */
        fun initial(goal: String, today: String, raceDate: String?): PlanForm {
            val start = nextPlanStartDate(today)
            val race = raceDate?.takeIf { it.isNotEmpty() }
            return PlanForm(
                goal = goal,
                daysPerWeek = DEFAULT_DAYS_PER_WEEK,
                experience = ExperienceLevel.Intermediate,
                startDate = start,
                endDate = race ?: addDaysToIsoDate(start, DEFAULT_PLAN_WEEKS * DAYS_IN_WEEK),
                endDateIsRaceDate = race != null,
                restDays = DEFAULT_REST_DAYS.getValue(DEFAULT_DAYS_PER_WEEK),
            )
        }
    }
}

/**
 * The saved preferences setup edits, in its inputs' shape. Setup starts from
 * what is saved, so "Run setup again" never shows defaults over an athlete's
 * own answers, and only what the athlete changes is sent.
 */
data class SetupProfile(
    val weightUnit: String = "kg",
    val distanceUnit: String = "km",
    val division: String = "open",
    val gender: String = "prefer_not_to_say",
    val age: String = "",
    val aiCoachEnabled: Boolean = false,
) {
    companion object {
        private val GENDERS = setOf("male", "female", "prefer_not_to_say")

        fun from(prefs: PreferencesResponse?): SetupProfile = if (prefs == null) {
            SetupProfile()
        } else {
            SetupProfile(
                weightUnit = if (prefs.weightUnit == "lbs") "lbs" else "kg",
                distanceUnit = if (prefs.distanceUnit == "miles") "miles" else "km",
                division = if (prefs.division == "pro") "pro" else "open",
                gender = prefs.gender?.takeIf { it in GENDERS } ?: "prefer_not_to_say",
                age = prefs.age?.toString().orEmpty(),
                aiCoachEnabled = prefs.aiCoachEnabled == true,
            )
        }
    }
}

/** The units step's changes, or null when there are none. A cleared age is sent as null. */
fun unitsPatch(shown: SetupProfile, saved: SetupProfile): UpdateUserPreferences? {
    val patch = UpdateUserPreferences(
        weightUnit = UpdateUserPreferences.WeightUnit.entries.firstOrNull { it.wireValue == shown.weightUnit }
            .takeIf { shown.weightUnit != saved.weightUnit },
        distanceUnit = UpdateUserPreferences.DistanceUnit.entries.firstOrNull { it.wireValue == shown.distanceUnit }
            .takeIf { shown.distanceUnit != saved.distanceUnit },
        division = UpdateUserPreferences.Division.entries.firstOrNull { it.wireValue == shown.division }
            .takeIf { shown.division != saved.division },
        gender = if (shown.gender != saved.gender) {
            Patch.of(UpdateUserPreferences.Gender.entries.firstOrNull { it.wireValue == shown.gender })
        } else {
            Patch.Absent
        },
        age = if (shown.age.trim() != saved.age) Patch.of(shown.age.trim().toIntOrNull()) else Patch.Absent,
    )
    return patch.takeIf { it != UpdateUserPreferences() }
}
