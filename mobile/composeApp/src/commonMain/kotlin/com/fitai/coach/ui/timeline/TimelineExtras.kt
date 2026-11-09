package com.fitai.coach.ui.timeline

import com.fitai.coach.core.api.generated.CoachNoteInputs
import com.fitai.coach.core.api.generated.PersonalRecord
import com.fitai.coach.core.api.generated.TimelineAnnotation
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.api.generated.TrainingOverviewStationCoverage
import com.fitai.coach.core.api.generated.TrainingOverviewSummary
import com.fitai.coach.core.api.generated.TrainingPlan
import com.fitai.coach.core.dates.dayDiff
import com.fitai.coach.core.exercises.generated.EXERCISE_DEFINITIONS
import com.fitai.coach.core.exercises.knownExerciseLabel
import com.fitai.coach.core.plans.PlanPhase
import com.fitai.coach.core.plans.TrainingPhase
import com.fitai.coach.core.plans.computeCurrentWeek
import com.fitai.coach.core.plans.computePlanPhase
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.formatClock
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.formatSetDistance
import com.fitai.coach.ui.format.longDate
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.workout.ExerciseGroup
import com.fitai.coach.ui.workout.exerciseGroups

// --- "This week" (TimelineSummaryCard) ---

/** The "This week" card's numbers. */
data class WeekSummary(
    val todayValue: String,
    val todayDetail: String?,
    val weeklyCompleted: Int,
    val weeklyGoal: Int,
    val streak: Int,
    /** Where the athlete is in the plan; null for a plan that can't be placed. */
    val phase: PlanPhase?,
    val raceValue: String,
    val raceDetail: String?,
    val radar: StationRadar?,
)

/**
 * The "This week" card for [today], or null for an account with nothing to
 * show yet (no plan, no entries, nothing done).
 */
fun weekSummary(
    entries: List<TimelineEntry>,
    plans: List<TrainingPlan>,
    selectedPlanId: String?,
    summary: TrainingOverviewSummary?,
    today: String,
): WeekSummary? {
    if (!hasWeekData(entries, plans, summary)) return null
    val todayEntry = todayEntry(entries, today)
    val plan = choosePlan(plans, selectedPlanId, today)
    val raceDate = plan?.raceDate ?: plan?.endDate
    return WeekSummary(
        todayValue = todayEntry?.focus?.trim()?.ifEmpty { null } ?: "No planned session today",
        todayDetail = todayDetail(todayEntry, plan),
        weeklyCompleted = (summary?.weeklyCompletedWorkouts ?: 0).toInt(),
        weeklyGoal = (summary?.weeklyGoal ?: 0).toInt().coerceAtLeast(1),
        streak = (summary?.currentStreak ?: 0).toInt(),
        phase = plan?.let { planPhase(it, today) },
        raceValue = raceCountdown(raceDate, today),
        raceDetail = raceDate?.let(::longDate) ?: plan?.name,
        radar = summary?.let { stationRadar(it.stationCoverage, it.coverageLookbackDays.toInt()) },
    )
}

private fun hasWeekData(entries: List<TimelineEntry>, plans: List<TrainingPlan>, summary: TrainingOverviewSummary?): Boolean =
    plans.isNotEmpty() || entries.isNotEmpty() || (summary?.weeklyCompletedWorkouts ?: 0) > 0 || (summary?.currentStreak ?: 0) > 0

/** Under today's session: done, what it is, or (with none) the plan's name. */
private fun todayDetail(todayEntry: TimelineEntry?, plan: TrainingPlan?): String? = when {
    todayEntry?.status == TimelineEntry.Status.Completed -> "Completed today"
    todayEntry != null -> todayEntry.mainWorkout.ifBlank { null }
    else -> plan?.name
}

/** Today's session: a planned one first, else a completed one (getTodayEntry). */
fun todayEntry(entries: List<TimelineEntry>, today: String): TimelineEntry? {
    val todays = entries.filter { it.date == today }
    return todays.firstOrNull { it.status == TimelineEntry.Status.Planned }
        ?: todays.firstOrNull { it.status == TimelineEntry.Status.Completed }
        ?: todays.firstOrNull()
}

/**
 * The plan the card describes (choosePlan): the one picked, else the one
 * running today (not retired before it), else any unretired plan with an end.
 */
fun choosePlan(plans: List<TrainingPlan>, selectedPlanId: String?, today: String): TrainingPlan? {
    if (selectedPlanId != null) return plans.firstOrNull { it.id == selectedPlanId }
    fun liveToday(plan: TrainingPlan) = plan.retiredOn.let { it == null || it > today }
    return plans.firstOrNull { plan ->
        val start = plan.startDate
        val end = plan.endDate
        start != null && end != null && start <= today && end >= today && liveToday(plan)
    } ?: plans.firstOrNull { it.endDate != null && it.retiredOn == null }
}

private fun planPhase(plan: TrainingPlan, today: String): PlanPhase? = plan.startDate
    ?.takeIf { plan.totalWeeks > 0 }
    ?.let { start -> computeCurrentWeek(start, plan.totalWeeks, today) }
    ?.let { week -> computePlanPhase(plan.totalWeeks, week) }

/** "Race day in 12 days", "Race day today", "Race day was 3 days ago" (formatRaceCountdown). */
fun raceCountdown(raceDate: String?, today: String): String {
    val days = raceDate?.let { dayDiff(today, it) } ?: return "No race date set"
    return when {
        days == 0 -> "Race day today"
        days > 0 -> "Race day in $days ${if (days == 1) "day" else "days"}"
        else -> "Race day was ${-days} ${if (days == -1) "day" else "days"} ago"
    }
}

/** "Build", "Race week" (formatPhaseName). */
fun phaseName(phase: TrainingPhase): String = if (phase == TrainingPhase.RaceWeek) "Race week" else phase.name

// --- Station radar ---

/** One station's freshness chip. */
data class StationChip(val station: String, val label: String, val freshness: String, val tone: BadgeTone)

/** The station chips and a sentence naming the coldest one. */
data class StationRadar(val chips: List<StationChip>, val headline: String)

/**
 * Days since each race station (and running) was trained, as chips, with the
 * coldest named (buildStationRadar). Null before any has been trained, so a
 * new athlete isn't told they've neglected nine things they've never done.
 */
fun stationRadar(coverage: List<TrainingOverviewStationCoverage>, lookbackDays: Int?): StationRadar? {
    if (coverage.isEmpty() || coverage.all { it.lastTrained == null }) return null
    val untouchedLabel = lookbackDays?.takeIf { it > 0 }?.let { "Not in ${it}d" }
    val chips = coverage.map { entry ->
        val days = entry.daysSince?.toInt()
        StationChip(
            station = entry.station,
            label = stationLabel(entry.station),
            freshness = if (entry.lastTrained == null && untouchedLabel != null) untouchedLabel else freshness(days),
            tone = stationTone(days),
        )
    }
    val coldest = coverage.firstOrNull { it.lastTrained == null } ?: coverage.maxBy { it.daysSince ?: 0 }
    val coldestLabel = stationLabel(coldest.station)
    val days = coldest.daysSince?.toInt()
    val headline = when {
        coldest.lastTrained == null && untouchedLabel != null -> "$coldestLabel has not been covered in the last $lookbackDays days."
        coldest.lastTrained == null -> "$coldestLabel is untouched — no session has covered it yet."
        stationTone(days) == BadgeTone.Success -> "Every station covered in the last $WATCH_AFTER_DAYS days."
        else -> "$coldestLabel is coldest — ${freshness(days).lowercase()}."
    }
    return StationRadar(chips, headline)
}

private fun stationLabel(station: String): String = if (station == "running") "Running" else EXERCISE_DEFINITIONS[station]?.label ?: station

private fun freshness(daysSince: Int?): String = when (daysSince) {
    null -> "Never trained"
    0 -> "Today"
    1 -> "Yesterday"
    else -> "${daysSince}d ago"
}

private fun stationTone(daysSince: Int?): BadgeTone = when {
    daysSince == null || daysSince > STALE_AFTER_DAYS -> BadgeTone.Danger
    daysSince > WATCH_AFTER_DAYS -> BadgeTone.Warning
    else -> BadgeTone.Success
}

private const val WATCH_AFTER_DAYS = 7
private const val STALE_AFTER_DAYS = 14

// --- Annotations ---

/** "Injury", "Rest block" (TYPE_LABELS). */
fun annotationLabel(type: TimelineAnnotation.Type): String = when (type) {
    TimelineAnnotation.Type.Injury -> "Injury"
    TimelineAnnotation.Type.Illness -> "Illness"
    TimelineAnnotation.Type.Travel -> "Travel"
    TimelineAnnotation.Type.Rest -> "Rest block"
    TimelineAnnotation.Type.Unknown -> "Note"
}

/** The note's colour (TYPE_COLORS: red, amber, sky, green). */
fun annotationTone(type: TimelineAnnotation.Type): BadgeTone = when (type) {
    TimelineAnnotation.Type.Injury -> BadgeTone.Danger
    TimelineAnnotation.Type.Illness -> BadgeTone.Warning
    TimelineAnnotation.Type.Travel -> BadgeTone.Accent
    TimelineAnnotation.Type.Rest -> BadgeTone.Success
    TimelineAnnotation.Type.Unknown -> BadgeTone.Neutral
}

/** "Nov 9 → Nov 12 · 4 days", counting both ends. */
fun annotationRange(annotation: TimelineAnnotation): String {
    val days = (dayDiff(annotation.startDate, annotation.endDate) ?: 0) + 1
    val span = if (days == 1) "1 day" else "$days days"
    val start = shortDate(annotation.startDate)
    return if (annotation.startDate == annotation.endDate) "$start · $span" else "$start → ${shortDate(annotation.endDate)} · $span"
}

/**
 * The rows with each note on the day it starts. A note starting between the
 * first and last day shown gets a row even with no sessions that day, and
 * notes show whatever the status filter, as on the web: an injury explains a
 * missed session.
 */
fun TimelineRows.withAnnotations(annotations: List<TimelineAnnotation>, today: String): TimelineRows {
    val first = days.firstOrNull()?.date
    val last = days.lastOrNull()?.date
    val byStart = if (first == null || last == null) emptyMap() else annotations.groupBy { it.startDate }.filterKeys { it in first..last }
    if (byStart.isEmpty()) return this
    val existing = days.associateBy { it.date }
    val dates = (existing.keys + byStart.keys).sorted()
    return copy(
        days = dates.map { date ->
            (existing[date] ?: TimelineDay(date, emptyList(), isToday = date == today)).copy(annotations = byStart[date].orEmpty())
        },
    )
}

// --- Exercise chips with PR trophies ---

/** One exercise on a card: "Back Squat 3x5 100kg", and whether it set a record in this workout. */
data class ExerciseChip(val text: String, val personalRecord: Boolean)

/** The chips for a logged session's exercises (ExerciseChips), records from [records]. */
fun exerciseChips(entry: TimelineEntry, records: Map<String, PersonalRecord>): List<ExerciseChip> =
    exerciseGroups(entry.exerciseSets.orEmpty()).map { group ->
        ExerciseChip(chipText(group), setRecordIn(group, entry.workoutLogId, records))
    }

/**
 * Whether [workoutLogId] holds one of the exercise's records (hasPRInWorkout):
 * heaviest, longest or fastest.
 */
fun setRecordIn(group: ExerciseGroup, workoutLogId: String?, records: Map<String, PersonalRecord>): Boolean {
    val key = if (group.exerciseName == "custom" && group.customLabel != null) "custom:${group.customLabel}" else group.exerciseName
    val record = records[key]?.takeIf { workoutLogId != null } ?: return false
    return listOfNotNull(record.maxWeight, record.maxDistance, record.bestTime).any { it.workoutLogId == workoutLogId }
}

/** "Back Squat 3x5 100kg" (formatExerciseSummary). */
fun chipText(group: ExerciseGroup): String {
    val sets = group.sets
    val first = sets.firstOrNull() ?: return group.label
    val parts = buildList {
        val reps = sets.map { it.reps }.distinct()
        when {
            reps.size == 1 && first.reps != null && sets.size > 1 -> add("${sets.size}x${first.reps}")
            first.reps != null && sets.size == 1 -> add("${first.reps}r")
            sets.size > 1 -> add("${sets.size} sets")
        }
        val weights = sets.mapNotNull { it.weight }.distinct()
        val unit = if (first.weightUnit == "lbs") "lbs" else "kg"
        if (weights.isNotEmpty()) add(weights.joinToString("/") { formatNumber(it) } + unit)
        first.distance?.let { add(formatSetDistance(it, first.distanceUnit)) }
        first.time?.let { add(formatClock(it)) }
    }
    return if (parts.isEmpty()) group.label else "${group.label} ${parts.joinToString(" ")}"
}

// --- Coach note ---

/** "Load governor" for a note's source (CoachNote's sourceLabel); null when it has none. */
fun coachSourceLabel(source: String?): String? = when (source) {
    "rag" -> "RAG"
    "legacy" -> "Legacy"
    "review" -> "Review"
    "load_governor" -> "Load governor"
    "progression" -> "Auto-progression"
    else -> null
}

/** What the coach based a note on, as chips (basedOnChips). */
fun basedOnChips(inputs: CoachNoteInputs?): List<String> {
    if (inputs == null) return emptyList()
    val phase = inputs.planPhase?.let { p -> TrainingPhase.entries.firstOrNull { it.wireValue == p.wireValue } }
    val candidates = listOf(
        "Your logged sessions".takeIf { inputs.lastModification?.kind == CoachNoteInputs.LastModification.Kind.AutoProgression },
        "Plan goal".takeIf { inputs.planGoalPresent == true },
        phase?.let { "${phaseName(it)} phase" },
        phase?.let(::nextPhases),
        rpeChip(inputs),
        inputs.weeklyVolumeTrend?.takeIf { it != CoachNoteInputs.WeeklyVolumeTrend.Unknown }?.let { "Volume ${it.wireValue}" },
        inputs.stationGaps?.let(::gapsChip),
        inputs.progressionFlags?.takeIf { it.isNotEmpty() }?.let { "Progression: ${it.size} ${if (it.size > 1) "flags" else "flag"}" },
        when (inputs.loadGovernorAcwrZone) {
            CoachNoteInputs.LoadGovernorAcwrZone.Danger -> "ACWR danger"
            CoachNoteInputs.LoadGovernorAcwrZone.Yellow -> "Yellow load"
            else -> null
        },
        inputs.recentWorkoutCount?.takeIf { it > 0 }?.let { "$it recent workouts" },
        "Coaching docs".takeIf { inputs.ragUsed == true },
    )
    return (candidates.filterNotNull() + loadVectorChips(inputs)).distinct()
}

/** Each load or pace an auto-progression moved: "Front Squat: 85 → 90 kg". */
fun progressionChanges(inputs: CoachNoteInputs?): List<String> = inputs?.progressionChanges.orEmpty().map { change ->
    if (change.kind == CoachNoteInputs.ProgressionChangesItem.Kind.Pace) {
        "Run paces: fitness ${formatNumber(change.from)} → ${formatNumber(change.to)} (VDOT)"
    } else {
        val label = knownExerciseLabel(change.exercise) ?: change.exercise.replace('_', ' ')
        "$label: ${formatNumber(change.from)} → ${formatNumber(change.to)} ${change.unit}"
    }
}

private fun nextPhases(phase: TrainingPhase): String? {
    val index = TrainingPhase.entries.indexOf(phase)
    if (index < 0 || index >= TrainingPhase.entries.lastIndex) return null
    return "Next: " + TrainingPhase.entries.drop(index + 1).joinToString(" → ", transform = ::phaseName)
}

private fun gapsChip(gaps: List<String>): String? =
    gaps.takeIf { it.isNotEmpty() }?.let { "Gaps: ${it.take(2).joinToString(", ")}${if (it.size > 2) "…" else ""}" }

private fun rpeChip(inputs: CoachNoteInputs): String? {
    val trend = inputs.rpeTrend
        ?.takeUnless { it == CoachNoteInputs.RpeTrend.InsufficientData || it == CoachNoteInputs.RpeTrend.Unknown }
        ?: return null
    return if (inputs.fatigueFlag == true) "Fatigue flag" else "RPE ${trend.wireValue}"
}

private fun loadVectorChips(inputs: CoachNoteInputs): List<String> {
    val vectors = inputs.loadGovernorFlaggedVectors.orEmpty().map { it.wireValue }.toMutableSet()
    inputs.loadGovernorRestrictions.orEmpty().forEach { restriction ->
        listOf("posterior_chain", "anterior_chain", "elastic_tendon").filter { it in restriction }.forEach(vectors::add)
    }
    return listOfNotNull(
        "Posterior chain".takeIf { "posterior_chain" in vectors },
        "Anterior chain".takeIf { "anterior_chain" in vectors },
        "Elastic load".takeIf { "elastic_tendon" in vectors },
    )
}

// --- Strava link ---

/** Something a Strava recording can be linked to: a planned session or a workout logged by hand. */
data class DeviceLinkOption(val label: String, val planDayId: String? = null, val workoutLogId: String? = null)

/** The sync's suggested match, if any, and every same-day session it could be linked to by hand. */
data class DeviceLinkOptions(val suggestion: DeviceLinkOption?, val candidates: List<DeviceLinkOption>)

/** A Strava import that is its own row: nothing is linked to it yet (isStandaloneStravaImport). */
fun isStandaloneStravaImport(entry: TimelineEntry): Boolean = entry.type == TimelineEntry.Type.Logged &&
    entry.source == "strava" &&
    entry.stravaActivityId != null &&
    entry.deviceLinkSource == null

/** Whether the card wears the Strava badge: a recording is on it. */
fun hasStravaRecording(entry: TimelineEntry): Boolean = entry.stravaActivityId != null || entry.source == "strava"

/**
 * What an import could be linked to, from the day's other entries
 * (resolveDeviceLinkOptions): open planned sessions and hand-logged workouts.
 */
fun deviceLinkOptions(entry: TimelineEntry, dayEntries: List<TimelineEntry>): DeviceLinkOptions {
    val siblings = dayEntries.filter { it.id != entry.id && it.date == entry.date }
    return DeviceLinkOptions(suggestedLink(entry, siblings), siblings.mapNotNull(::linkTarget))
}

/** [other] as something to link a recording to: an open planned session or a workout logged by hand. */
private fun linkTarget(other: TimelineEntry): DeviceLinkOption? {
    val planDayId = other.planDayId
    val workoutLogId = other.workoutLogId
    val openSession = other.type == TimelineEntry.Type.Planned &&
        (other.status == TimelineEntry.Status.Planned || other.status == TimelineEntry.Status.Missed)
    val loggedByHand = other.type == TimelineEntry.Type.Logged &&
        other.stravaActivityId == null && other.source != "strava" && other.source != "garmin"
    return when {
        openSession && planDayId != null -> DeviceLinkOption(other.focus, planDayId = planDayId)
        loggedByHand && workoutLogId != null -> DeviceLinkOption(other.focus, workoutLogId = workoutLogId)
        else -> null
    }
}

/** The match the sync recorded on [entry], named from its day's entries. */
private fun suggestedLink(entry: TimelineEntry, siblings: List<TimelineEntry>): DeviceLinkOption? = entry.suggestedPlanDayId?.let { id ->
    DeviceLinkOption(siblings.firstOrNull { it.planDayId == id }?.focus ?: "that planned session", planDayId = id)
} ?: entry.suggestedWorkoutLogId?.let { id ->
    DeviceLinkOption(siblings.firstOrNull { it.workoutLogId == id }?.focus ?: "that logged workout", workoutLogId = id)
}
