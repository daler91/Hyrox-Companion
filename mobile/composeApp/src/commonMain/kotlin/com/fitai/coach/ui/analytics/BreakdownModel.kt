package com.fitai.coach.ui.analytics

import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.core.api.generated.TrainingOverview.MovementPatternCoverageItem.Pattern
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.BodyRegion
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.Muscle
import kotlin.math.ceil
import kotlin.math.roundToInt

// The Breakdown tab (CategoryBreakdownTab.tsx, MuscleHeatMapCard.tsx, coverageAnalysis.tsx).

private const val PERCENT = 100.0

/** One slice of the training mix: a category's sessions and its share of all of them. */
data class CategorySlice(val category: String, val label: String, val sessions: Long, val percent: Int)

/** "Functional" for "functional" (categoryLabels); anything else as it came. */
fun categoryLabel(category: String): String = when (category) {
    "functional" -> "Functional"
    "running" -> "Running"
    "strength" -> "Strength"
    "conditioning" -> "Conditioning"
    else -> category.replaceFirstChar { it.uppercase() }
}

/** The categories with sessions, largest first, each with its share. */
fun categorySlices(totals: Map<String, TrainingOverview.CategoryTotalsValue>): List<CategorySlice> {
    val withSessions = totals.filterValues { it.count > 0 }
    val all = withSessions.values.sumOf { it.count }
    return withSessions
        .map { (category, value) ->
            CategorySlice(category, categoryLabel(category), value.count, (value.count * PERCENT / all).roundToInt())
        }
        .sortedByDescending { it.sessions }
}

/** How a coverage reading should be read: on track, worth a look, or a gap (AnalysisTone). */
enum class CoverageTone { Good, Watch, Gap }

/** A movement pattern or muscle group's work in the range, whichever it came from (CoverageWork). */
data class Coverage(val id: String, val label: String, val sessions: Long, val sets: Long, val lastTrained: String?, val daysSince: Long?) {
    val trained: Boolean get() = sessions > 0 || sets > 0 || lastTrained != null
}

fun TrainingOverview.MovementPatternCoverageItem.coverage() = Coverage(
    pattern.wireValue,
    label,
    sessionCount,
    totalSets,
    lastTrained,
    daysSince,
)

fun TrainingOverview.MuscleGroupCoverageItem.coverage() = Coverage(muscle.wireValue, label, sessionCount, totalSets, lastTrained, daysSince)

/** A headline reading (AnalysisMetric). */
data class CoverageMetric(val label: String, val value: String, val detail: String, val tone: CoverageTone)

/** One side against another, in sets (BalanceAnalysis); [recommendation] is null when it's balanced. */
data class CoverageBalance(val label: String, val value: String, val detail: String, val tone: CoverageTone, val recommendation: String?)

/** A card's analysis: its readings, its balances, what to do next, and how many set assignments it read. */
data class CoverageAnalysis(
    val metrics: List<CoverageMetric>,
    val balances: List<CoverageBalance>,
    val nextFocus: String,
    val totalSets: Long,
)

/** A gap beyond this many days is stale (STALE_AFTER_DAYS). */
const val STALE_AFTER_DAYS = 14

/** One side has this many times the other's sets before it reads as leading (BALANCE_RATIO_THRESHOLD). */
private const val BALANCE_RATIO = 1.6

/** "1 set", "3 sets". */
fun countOf(value: Long, singular: String, plural: String): String = "$value ${if (value == 1L) singular else plural}"

/** "25%", "0%" of nothing. */
fun percentOf(value: Long, total: Long): String = if (total <= 0) "0%" else "${(value * PERCENT / total).roundToInt()}%"

/** "Today", "Yesterday", "9d ago", "Never trained" (getFreshnessLabel). */
fun freshnessLabel(daysSince: Long?): String = when (daysSince) {
    null -> "Never trained"
    0L -> "Today"
    1L -> "Yesterday"
    else -> "${daysSince}d ago"
}

private const val FRESH_WITHIN_DAYS = 7

/** Green within a week, amber within two, red beyond or never (getFreshnessColor). */
fun freshnessTone(daysSince: Long?): CoverageTone = when {
    daysSince == null || daysSince > STALE_AFTER_DAYS -> CoverageTone.Gap
    daysSince > FRESH_WITHIN_DAYS -> CoverageTone.Watch
    else -> CoverageTone.Good
}

/** The sets of every item whose id is in [ids]. */
fun sumSets(items: List<Coverage>, ids: Set<String>): Long = items.filter { it.id in ids }.sumOf { it.sets }

/** The most loaded trained item: most sets, then most sessions, then first by name (findTopCoverage). */
fun topCoverage(items: List<Coverage>): Coverage? = items.filter { it.trained }
    .sortedWith(compareByDescending<Coverage> { it.sets }.thenByDescending { it.sessions }.thenBy { it.label })
    .firstOrNull()

/** The least loaded trained item: fewest sets, then first by name. */
fun leastLoaded(
    items: List<Coverage>,
): Coverage? = items.filter { it.trained }.minWithOrNull(compareBy<Coverage> { it.sets }.thenBy { it.label })

/**
 * What most needs adding (findPriorityGap): the first item never trained, else
 * the one stalest beyond two weeks; null when everything is fresh.
 */
fun priorityGap(items: List<Coverage>, neverTrainedReason: String): Pair<Coverage, String>? {
    val neverTrained = items.firstOrNull { !it.trained || it.daysSince == null }
    val stalest = items.filter { (it.daysSince ?: 0) > STALE_AFTER_DAYS }.maxByOrNull { it.daysSince ?: 0 }
    return when {
        neverTrained != null -> neverTrained to neverTrainedReason
        stalest != null -> stalest to "last trained ${freshnessLabel(stalest.daysSince).lowercase()}"
        else -> null
    }
}

/** Two sides' sets read as one balance (buildBalanceAnalysis), the left side named first. */
fun balance(label: String, left: String, leftSets: Long, right: String, rightSets: Long): CoverageBalance {
    val value = "${countOf(leftSets, "set", "sets")} / ${countOf(rightSets, "set", "sets")}"
    val l = left.lowercase()
    return when {
        leftSets == 0L && rightSets == 0L ->
            CoverageBalance(
                label,
                value,
                "No $l or $right volume logged.",
                CoverageTone.Gap,
                "Add $l and $right exposure before judging this balance.",
            )
        leftSets == 0L -> CoverageBalance(label, value, "Missing $l volume.", CoverageTone.Gap, "Add $l work to balance $right volume.")
        rightSets == 0L -> CoverageBalance(
            label,
            value,
            "$left volume is leading $right volume.",
            CoverageTone.Gap,
            "Add $right work to balance $l volume.",
        )
        leftSets.toDouble() / rightSets >= BALANCE_RATIO ->
            CoverageBalance(
                label,
                value,
                "$left volume is leading $right volume.",
                CoverageTone.Watch,
                "Add $right work before more $l volume.",
            )
        leftSets.toDouble() / rightSets <= 1 / BALANCE_RATIO -> CoverageBalance(
            label,
            value,
            "$right volume is leading $l volume.",
            CoverageTone.Watch,
            "Add $l work before more $right volume.",
        )
        else -> CoverageBalance(label, value, "$left and $right volume are balanced.", CoverageTone.Good, null)
    }
}

private fun nextFocus(gap: Pair<Coverage, String>?, balances: List<CoverageBalance>, least: Coverage?, kind: String, none: String): String {
    val unbalanced = balances.firstOrNull { it.tone != CoverageTone.Good && it.recommendation != null }
    return when {
        gap != null -> "Next focus: Add ${gap.first.label}; ${gap.second}."
        unbalanced != null -> "Next focus: ${unbalanced.recommendation}"
        least != null -> "Next focus: Keep ${least.label} in rotation; it is the lowest loaded trained $kind."
        else -> none
    }
}

// --- Movement patterns ---

private val PUSH_PATTERNS = setOf(Pattern.HorizontalPush, Pattern.VerticalPush).map { it.wireValue }.toSet()
private val PULL_PATTERNS = setOf(Pattern.HorizontalPull, Pattern.VerticalPull).map { it.wireValue }.toSet()
private val SQUAT_LUNGE = setOf(Pattern.Squat, Pattern.LungeSplitSquat).map { it.wireValue }.toSet()

/** The movement pattern card's analysis (buildMovementPatternAnalysis). */
fun movementPatternAnalysis(patterns: List<TrainingOverview.MovementPatternCoverageItem>): CoverageAnalysis {
    val items = patterns.map { it.coverage() }
    val trained = items.count { it.trained }
    val top = topCoverage(items)
    val gap = priorityGap(items, "it has no logged sessions in this range")
    val balances = listOf(
        balance("Push / Pull", "Push", sumSets(items, PUSH_PATTERNS), "pull", sumSets(items, PULL_PATTERNS)),
        balance("Squat+Lunge / Hinge", "Squat/lunge", sumSets(items, SQUAT_LUNGE), "hinge", sumSets(items, setOf(Pattern.Hinge.wireValue))),
        balance(
            "Core Flexion / Anti-rotation",
            "Core flexion",
            sumSets(items, setOf(Pattern.CoreFlexion.wireValue)),
            "anti-rotation",
            sumSets(items, setOf(Pattern.CoreAntiRotation.wireValue)),
        ),
    )
    val metrics = listOf(
        CoverageMetric(
            "Coverage",
            "$trained/${items.size}",
            "${percentOf(trained.toLong(), items.size.toLong())} of movement patterns trained in this range.",
            if (trained == items.size) CoverageTone.Good else CoverageTone.Watch,
        ),
        top?.let {
            CoverageMetric(
                "Strongest",
                it.label,
                "${countOf(it.sets, "set", "sets")} across ${countOf(it.sessions, "session", "sessions")}.",
                CoverageTone.Good,
            )
        }
            ?: CoverageMetric(
                "Strongest",
                "No loaded pattern",
                "Log strength or functional sets to reveal the dominant pattern.",
                CoverageTone.Gap,
            ),
        gap?.let { CoverageMetric("Gap", it.first.label, it.second, CoverageTone.Gap) }
            ?: CoverageMetric(
                "Gap",
                "No stale gaps",
                "Every trained movement pattern is inside the 14-day freshness window.",
                CoverageTone.Good,
            ),
    )
    val next =
        nextFocus(
            gap,
            balances,
            leastLoaded(items),
            "pattern",
            "Next focus: Log a strength or functional movement so coverage analysis can start.",
        )
    return CoverageAnalysis(metrics, balances, next, items.sumOf { it.sets })
}

// --- Muscle groups ---

private val UPPER_PUSH = setOf(Muscle.Chest, Muscle.Shoulders, Muscle.Triceps).map { it.wireValue }.toSet()
private val UPPER_PULL = setOf(Muscle.Lats, Muscle.UpperBack, Muscle.RearDelts, Muscle.Traps, Muscle.Biceps).map { it.wireValue }.toSet()
private val POSTERIOR_CHAIN = setOf(Muscle.Hamstrings, Muscle.Glutes, Muscle.LowerBack).map { it.wireValue }.toSet()
private val CORE_AREAS = setOf(Muscle.Core, Muscle.Obliques, Muscle.LowerBack)

/** "Upper body", "Core", "Lower body" (REGION_LABELS). */
fun regionLabel(region: BodyRegion): String = when (region) {
    BodyRegion.Upper -> "Upper body"
    BodyRegion.Core -> "Core"
    BodyRegion.Lower, BodyRegion.Unknown -> "Lower body"
}

/** The regions in the order the card lists them. */
val BODY_REGIONS = listOf(BodyRegion.Upper, BodyRegion.Core, BodyRegion.Lower)

/** The muscle card's analysis (buildMuscleHeatMapAnalysis). */
fun muscleAnalysis(muscles: List<TrainingOverview.MuscleGroupCoverageItem>): CoverageAnalysis {
    val items = muscles.map { it.coverage() }
    val total = items.sumOf { it.sets }
    val byRegion = BODY_REGIONS.associateWith { region -> muscles.filter { it.bodyRegion == region }.sumOf { it.totalSets } }
    val mix = BODY_REGIONS.joinToString(" / ") { "${regionLabel(it).removeSuffix(" body")} ${percentOf(byRegion.getValue(it), total)}" }
    val dominant = byRegion.maxByOrNull { it.value }
    val top = topCoverage(items)
    val gap = priorityGap(items, "it has no logged sets in this range")
    val balances = listOf(
        balance("Upper Push / Pull", "Upper push", sumSets(items, UPPER_PUSH), "upper pull", sumSets(items, UPPER_PULL)),
        balance(
            "Quad / Posterior Chain",
            "Quad work",
            sumSets(items, setOf(Muscle.Quads.wireValue)),
            "posterior chain",
            sumSets(items, POSTERIOR_CHAIN),
        ),
    )
    val metrics = listOf(
        CoverageMetric(
            "Region mix",
            if (total > 0 && dominant != null) "${regionLabel(dominant.key)} ${percentOf(dominant.value, total)}" else "No set volume",
            "$mix by set volume.",
            if (total > 0) CoverageTone.Good else CoverageTone.Gap,
        ),
        top?.let {
            CoverageMetric(
                "Top load",
                it.label,
                "${countOf(it.sets, "set", "sets")} across ${countOf(it.sessions, "session", "sessions")}.",
                CoverageTone.Good,
            )
        } ?: CoverageMetric("Top load", "No loaded muscle", "Log mapped sets to reveal the most-loaded muscle group.", CoverageTone.Gap),
        gap?.let { CoverageMetric("Cold gap", it.first.label, it.second, CoverageTone.Gap) }
            ?: CoverageMetric(
                "Cold gap",
                "No stale gaps",
                "Every trained muscle group is inside the 14-day freshness window.",
                CoverageTone.Good,
            ),
        coreFreshness(muscles),
    )
    val next = nextFocus(
        gap,
        balances,
        leastLoaded(items),
        "muscle group",
        "Next focus: Log mapped strength or functional sets so muscle coverage analysis can start.",
    )
    return CoverageAnalysis(metrics, balances, next, total)
}

/** How recently core, obliques and lower back were trained (buildCoreFreshnessMetric). */
private fun coreFreshness(muscles: List<TrainingOverview.MuscleGroupCoverageItem>): CoverageMetric {
    val core = muscles.filter { it.muscle in CORE_AREAS }.map { it.coverage() }
    val freshest = core.filter { it.trained }.minByOrNull { it.daysSince ?: Long.MAX_VALUE }
        ?: return CoverageMetric(
            "Core freshness",
            "No core work",
            "Core, obliques, and lower back have no logged sets in this range.",
            CoverageTone.Gap,
        )
    val needing = core.count { !it.trained || it.daysSince == null || it.daysSince > STALE_AFTER_DAYS }
    return CoverageMetric(
        "Core freshness",
        freshnessLabel(freshest.daysSince),
        "${freshest.label} is freshest; ${countOf(needing.toLong(), "core area", "core areas")} need attention.",
        if (needing > 0) CoverageTone.Watch else CoverageTone.Good,
    )
}

/** The heat map's five set-volume levels, as the legend names them (HEAT_TONES). */
val HEAT_LEVEL_LABELS = listOf("No set volume", "Light set volume", "Moderate set volume", "High set volume", "Peak set volume")

/** The levels above "no set volume", one per quarter of the most-loaded muscle's sets. */
private val HEAT_STEPS = HEAT_LEVEL_LABELS.lastIndex

/** 0 for none, then 1–4 by quarter of the most-loaded muscle's sets (getHeatLevel: ≤25%, ≤50%, ≤75%, more). */
fun heatLevel(sets: Long, maxSets: Long): Int =
    if (sets <= 0 || maxSets <= 0) 0 else ceil(sets.toDouble() / maxSets * HEAT_STEPS).toInt().coerceIn(1, HEAT_STEPS)

/** Whether the tab has anything to show beyond its welcome. */
fun hasBreakdown(overview: TrainingOverview): Boolean = overview.categoryTotals.values.any { it.count > 0 } ||
    overview.movementPatternCoverage.any { it.coverage().trained } ||
    overview.muscleGroupCoverage.any { it.coverage().trained }
