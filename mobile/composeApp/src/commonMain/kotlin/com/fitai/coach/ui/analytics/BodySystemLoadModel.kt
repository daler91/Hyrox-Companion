package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.format.shortDate
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.roundToLong

private typealias SystemLoad = TrainingOverview.BodySystemLoad.SystemsItem
private typealias BodySystem = TrainingOverview.BodySystemLoad.SystemsItem.System
private typealias SystemStatus = TrainingOverview.BodySystemLoad.SystemsItem.Status

// --- Load by body system (BodySystemLoadCard, shared/bodySystemLoad) ---

fun bodySystemLabel(system: BodySystem): String = when (system) {
    BodySystem.Aerobic -> "Aerobic"
    BodySystem.RunningImpact -> "Running impact"
    BodySystem.LegMuscle -> "Leg muscle"
    BodySystem.UpperPull -> "Upper-body pull"
    BodySystem.Unknown -> "Other"
}

/** What each system covers (BODY_SYSTEM_META). */
fun bodySystemDescription(system: BodySystem): String = when (system) {
    BodySystem.Aerobic ->
        "Heart and lungs. Running, ergs, bikes, swimming and conditioning load it most; lifting loads it a little."
    BodySystem.RunningImpact ->
        "Foot-strike load on bones, joints and tendons. Running, jumping and skipping; bikes, rowers and the SkiErg add none."
    BodySystem.LegMuscle ->
        "Quads, hamstrings, glutes and calves. Squats, hinges, lunges, sleds and wall balls, plus a share of every run and ride."
    BodySystem.UpperPull ->
        "Back, lats, biceps and grip. Rows, pull-ups, the SkiErg, sled pulls, rope climbs and carries."
    BodySystem.Unknown -> ""
}

private fun noun(system: BodySystem): String = bodySystemLabel(system).lowercase()

/** Any load at all in the six weeks: the card shows on exactly this. */
fun hasBodySystemLoad(load: TrainingOverview.BodySystemLoad?): Boolean =
    load?.systems?.any { system -> system.weekly.any { (it ?: 0.0) > 0 } } == true

/** The status chip's word and colour; the word carries it, never colour alone. */
fun bodySystemStatus(status: SystemStatus): Pair<String, BadgeTone> = when (status) {
    SystemStatus.Minimal -> "Minimal" to BadgeTone.Neutral
    SystemStatus.New -> "New load" to BadgeTone.Warning
    SystemStatus.Low -> "Below usual" to BadgeTone.Accent
    SystemStatus.Normal -> "Normal" to BadgeTone.Success
    SystemStatus.High -> "High" to BadgeTone.Warning
    SystemStatus.VeryHigh -> "Very high" to BadgeTone.Danger
    SystemStatus.InsufficientData, SystemStatus.Unknown -> "Building baseline" to BadgeTone.Neutral
}

private const val PERCENT = 100

private fun percentChange(ratio: Double): Int = ((ratio - 1) * PERCENT).roundToInt()

/** 1.31 → "+31%", 0.7 → "-30%" (formatLoadChange). */
fun formatLoadChange(ratio: Double): String = percentChange(ratio).let { if (it > 0) "+$it%" else "$it%" }

/** "1,204": a load, whole. */
fun formatLoad(value: Double): String = groupThousands(value.roundToLong())

private const val DIGITS_PER_GROUP = 3

private fun groupThousands(value: Long): String {
    val digits = abs(value).toString().reversed().chunked(DIGITS_PER_GROUP).joinToString(",").reversed()
    return if (value < 0) "-$digits" else digits
}

/** How this week compares, or why it can't yet; then the peak a six-week high beat. */
fun bodySystemDetail(system: SystemLoad): String {
    val comparison = when (system.status) {
        SystemStatus.InsufficientData -> "Needs three weeks of history to compare"
        SystemStatus.Minimal -> "Too little load to compare"
        SystemStatus.New -> "Almost none in the previous four weeks"
        else -> system.ratio?.let { ratio ->
            system.baseline?.let { "${formatLoadChange(ratio)} vs your usual week (${formatLoad(it)})" }
        }
    }
    val peak = system.previousPeak?.takeIf { system.sixWeekHigh }?.let { "Previous peak ${formatLoad(it)}" }
    return listOfNotNull(comparison, peak).joinToString(". ")
}

private fun isNotable(system: SystemLoad): Boolean =
    system.sixWeekHigh || system.status in setOf(SystemStatus.High, SystemStatus.VeryHigh, SystemStatus.New)

private fun joinWithAnd(items: List<String>): String =
    if (items.size <= 1) items.lastOrNull().orEmpty() else items.dropLast(1).joinToString(", ") + " and " + items.last()

private fun notablePhrase(system: SystemLoad): String {
    val above = system.ratio?.let(::percentChange)?.takeIf { it > 0 }?.let { "$it% above your usual week" }
    return when {
        system.status == SystemStatus.New -> "${noun(system.system)} load jumped from almost none in the previous four weeks"
        system.sixWeekHigh -> "${noun(system.system)} load is at a six-week high" + (above?.let { " ($it)" } ?: "")
        else -> "${noun(system.system)} load is ${above ?: "above your usual week"}"
    }
}

private fun groupClause(systems: List<SystemLoad>, state: String): String =
    "${joinWithAnd(systems.map { noun(it.system) })} ${if (systems.size == 1) "load is" else "loads are"} $state"

/** The banner over the tiles: what diverges, and how loud to say it. */
data class Divergence(val text: String, val severe: Boolean)

/**
 * The divergence one overall number hides, as a sentence — "Leg muscle load is
 * at a six-week high (31% above your usual week), while aerobic load is
 * normal." — or null when nothing stands out (describeBodySystemDivergence).
 */
fun bodySystemDivergence(load: TrainingOverview.BodySystemLoad): Divergence? {
    val notable = load.systems.filter(::isNotable)
    if (notable.isEmpty()) return null
    val calm = load.systems.filterNot(::isNotable)
    val normal = calm.filter { it.status == SystemStatus.Normal }
    val low = calm.filter { it.status == SystemStatus.Low }
    val contrast = listOfNotNull(
        normal.takeIf { it.isNotEmpty() }?.let { groupClause(it, "normal") },
        low.takeIf { it.isNotEmpty() }?.let { groupClause(it, "below usual") },
    )
    val sentence = joinWithAnd(notable.map(::notablePhrase)) + if (contrast.isEmpty()) "" else ", while ${joinWithAnd(contrast)}"
    return Divergence(
        sentence.replaceFirstChar { it.uppercase() } + ".",
        severe = load.systems.any { it.status == SystemStatus.VeryHigh },
    )
}

/** What the split couldn't see: estimated, unsplit and uncounted sessions (coverageNotes). */
fun bodySystemNotes(load: TrainingOverview.BodySystemLoad): List<String> = listOfNotNull(
    load.estimatedSessions.takeIf { it > 0 }?.let {
        "$it of ${load.sessionCount} sessions had no RPE or duration logged, so their load is estimated — " +
            "rate your sessions to sharpen the split."
    },
    load.unattributedSessions.takeIf { it > 0 }?.let {
        "$it ${if (it == 1L) "session" else "sessions"} couldn't be split because no exercises were logged."
    },
    load.unscoredSessions.takeIf { it > 0 }?.let {
        if (it == 1L) {
            "1 session has no duration or exercises and isn't counted."
        } else {
            "$it sessions have no duration or exercises and aren't counted."
        }
    },
)

/** "This week" for the newest block, else its dates. */
fun bodySystemWeekLabel(weeks: List<TrainingOverview.BodySystemLoad.WeeksItem>, index: Int): String = when {
    index == weeks.lastIndex -> "This week"
    index in weeks.indices -> "${shortDate(weeks[index].start)} – ${shortDate(weeks[index].end)}"
    else -> ""
}
