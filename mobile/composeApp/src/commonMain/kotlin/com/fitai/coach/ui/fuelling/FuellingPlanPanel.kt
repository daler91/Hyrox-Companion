package com.fitai.coach.ui.fuelling

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.Stable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.Patch
import com.fitai.coach.core.api.generated.GetNutritionPlannedSessionEstimateByPlanDayIdResponse
import com.fitai.coach.core.api.generated.PatchPlansDaysByDayIdRequest
import com.fitai.coach.core.api.generated.TimelineEntry
import com.fitai.coach.core.nutrition.SessionFuellingTargetInput
import com.fitai.coach.core.nutrition.computeSessionFuellingTarget
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.FitaiTextField
import com.fitai.coach.ui.components.RpeSelector
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import com.fitai.coach.ui.workout.formatTimeOfDay
import com.fitai.coach.ui.workout.parseTimeOfDay
import kotlin.math.roundToInt

private typealias Estimate = GetNutritionPlannedSessionEstimateByPlanDayIdResponse

/** The server's estimate for a planned session: one to use, none for this day (gone, or nutrition off), or none for now. */
sealed interface EstimateResult {
    data class Ready(val estimate: Estimate) : EstimateResult

    /** A 404: the plan day isn't there for this athlete, or nutrition is switched off. The panel hides. */
    data object NotFound : EstimateResult

    /** Offline or a server error: the panel shows targets from what's saved. */
    data object Failed : EstimateResult
}

/** What a planned session's fuelling panel needs from its screen. */
class PlanFuelling(
    val bodyweightKg: Double?,
    val loadEstimate: suspend (planDayId: String) -> EstimateResult,
    /** Saves an expected duration, effort or start time on [TimelineEntry]'s plan day. */
    val onEdit: (TimelineEntry, PatchPlansDaysByDayIdRequest) -> Unit,
)

/**
 * The fuelling panel's working values for one session. Saved expected values
 * win; otherwise the server's estimate fills them in, until the athlete
 * changes that field, so an estimate arriving late never overwrites an edit.
 * Each change returns the edit to save.
 */
@Stable
class PlanDraft(private val entry: TimelineEntry) {
    var durationText: String by mutableStateOf(entry.expectedDurationMin?.toString().orEmpty())
        private set
    var rpe: Int? by mutableStateOf(entry.expectedRpe)
        private set
    var timeText: String by mutableStateOf(entry.plannedTimeOfDayMin?.let(::formatTimeOfDay).orEmpty())
        private set

    /** Shown or hidden by the athlete; null follows whether there's a duration yet. */
    var expandedChoice: Boolean? by mutableStateOf(null)

    private var durationTouched = false
    private var rpeTouched = false

    val duration: Int? get() = durationText.toIntOrNull()?.let(::clampDuration)

    /** The start time as typed, when it's a clock time; null while it isn't. */
    val timeOfDay: Int? get() = parseTimeOfDay(timeText)

    val timeInvalid: Boolean get() = timeText.isNotBlank() && timeOfDay == null

    val expanded: Boolean get() = expandedChoice ?: (duration == null)

    fun useEstimate(estimate: Estimate) {
        if (entry.expectedDurationMin == null &&
            !durationTouched
        ) {
            estimate.durationMin?.let { durationText = clampDuration(it.roundToInt()).toString() }
        }
        if (entry.expectedRpe == null && !rpeTouched) estimate.rpe?.let { rpe = it.roundToInt() }
    }

    fun typeDuration(text: String): PatchPlansDaysByDayIdRequest {
        durationTouched = true
        durationText = text.filter(Char::isDigit).take(DURATION_DIGITS)
        return PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(duration))
    }

    fun stepDuration(by: Int): PatchPlansDaysByDayIdRequest {
        durationTouched = true
        durationText = clampDuration((duration ?: 0) + by).toString()
        return PatchPlansDaysByDayIdRequest(expectedDurationMin = Patch.Value(duration))
    }

    fun pickRpe(value: Int?): PatchPlansDaysByDayIdRequest {
        rpeTouched = true
        rpe = value
        return PatchPlansDaysByDayIdRequest(expectedRpe = Patch.Value(value))
    }

    /** The edit to save, or null while the text isn't a time yet (an empty field clears it). */
    fun typeTime(text: String): PatchPlansDaysByDayIdRequest? {
        timeText = text.take(TIME_CHARS)
        return when {
            timeText.isBlank() -> PatchPlansDaysByDayIdRequest(plannedTimeOfDayMin = Patch.Value(null))
            timeOfDay != null -> PatchPlansDaysByDayIdRequest(plannedTimeOfDayMin = Patch.Value(timeOfDay))
            else -> null
        }
    }

    private companion object {
        const val DURATION_DIGITS = 3
        const val TIME_CHARS = 5
    }
}

/** The stepper's step, in minutes. */
private const val DURATION_STEP = 5

/**
 * "Fuel for this session" on a planned session (FuellingPlanPanel.tsx): carbs
 * before, carbs and protein after, from the session's expected duration and
 * effort and the athlete's bodyweight. The duration, effort and start time can
 * be adjusted, and are saved on the plan day so the targets (and that day's
 * meal targets) remember them.
 */
@Composable
fun FuellingPlanPanel(entry: TimelineEntry, fuelling: PlanFuelling) {
    val planDayId = entry.planDayId ?: return
    val draft = remember(entry.id) { PlanDraft(entry) }
    var estimate by remember(entry.id) { mutableStateOf<EstimateResult?>(null) }
    // With both values saved, the estimate has nothing to fill in (and stays off the AI budget).
    val bothSaved = entry.expectedDurationMin != null && entry.expectedRpe != null
    LaunchedEffect(entry.id, bothSaved) {
        if (bothSaved) return@LaunchedEffect
        val result = fuelling.loadEstimate(planDayId)
        estimate = result
        if (result is EstimateResult.Ready) draft.useEstimate(result.estimate)
    }
    if (estimate == EstimateResult.NotFound) return

    val target = computeSessionFuellingTarget(
        SessionFuellingTargetInput(
            durationMin = draft.duration?.toDouble(),
            rpe = draft.rpe?.toDouble(),
            bodyweightKg = fuelling.bodyweightKg,
        ),
    )
    val ready = (estimate as? EstimateResult.Ready)?.estimate
    val hint = planHint(
        noBodyweight = "no_bodyweight_defaults" in target.reasonCodes,
        hasDuration = draft.duration != null,
        usingEstimate =
        entry.expectedDurationMin == null && ready != null &&
            ready.source != GetNutritionPlannedSessionEstimateByPlanDayIdResponse.Source.None,
    )
    val save = { edit: PatchPlansDaysByDayIdRequest -> fuelling.onEdit(entry, edit) }

    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            FuellingTitle("Fuel for this session")
            Labelled("Before training") { PreCarbTargetLine(target.preCarbG) }
            Labelled("After training") { PostTargetLine(target.postCarbG, target.postProteinG) }
            hint?.let { PlanHintLine(it, rationale = ready?.rationale?.takeIf { ready.refined }) }
            HorizontalDivider(color = FitaiTheme.colors.border)
            AdjustHeader(adjustSummary(draft.duration, draft.rpe, draft.timeText.takeIf { draft.timeOfDay != null }), draft.expanded) {
                draft.expandedChoice = !draft.expanded
            }
            if (draft.expanded) AdjustFields(draft, save)
            FuellingGuidanceNote(target.explanation)
        }
    }
}

@Composable
private fun Labelled(label: String, content: @Composable () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
        content()
    }
}

/** The hint under the targets, with the AI's reasoning behind an info button when it refined the estimate. */
@Composable
private fun PlanHintLine(hint: PlanHint, rationale: String?) {
    if (rationale == null) {
        Text(hint.text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        return
    }
    var open by remember(rationale) { mutableStateOf(false) }
    Column {
        ExplainedLine(hint.text, open, showLabel = "Why this estimate", hideLabel = "Hide why this estimate") { open = !open }
        if (open) Text(rationale, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

/** "Adjust session estimate · 60 min · RPE 7", opening the fields behind it. */
@Composable
private fun AdjustHeader(summary: String, expanded: Boolean, onToggle: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(role = Role.Button, onClick = onToggle)
            .semantics { stateDescription = if (expanded) "Expanded" else "Collapsed" }
            .padding(vertical = Spacing.Sm),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            "Adjust session estimate" + summary.takeIf { it.isNotEmpty() }?.let { " · $it" }.orEmpty(),
            style = FitaiTheme.typography.label,
            color = FitaiTheme.colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        Icon(
            LucideIcons.ChevronDown,
            contentDescription = null,
            tint = FitaiTheme.colors.textMuted,
            modifier = Modifier.size(16.dp).rotate(if (expanded) HALF_TURN else 0f),
        )
    }
}

private const val HALF_TURN = 180f

@Composable
private fun AdjustFields(draft: PlanDraft, save: (PatchPlansDaysByDayIdRequest) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = { save(draft.stepDuration(-DURATION_STEP)) }) {
                Icon(LucideIcons.Minus, contentDescription = "Decrease expected duration", tint = FitaiTheme.colors.text)
            }
            FitaiTextField(
                draft.durationText,
                { save(draft.typeDuration(it)) },
                "Expected duration (min)",
                Modifier.weight(1f),
                placeholder = "min",
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            )
            IconButton(onClick = { save(draft.stepDuration(DURATION_STEP)) }) {
                Icon(LucideIcons.Plus, contentDescription = "Increase expected duration", tint = FitaiTheme.colors.text)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            Text("Expected effort", style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted)
            RpeSelector(draft.rpe, { save(draft.pickRpe(it)) })
        }
        FitaiTextField(
            draft.timeText,
            { text -> draft.typeTime(text)?.let(save) },
            "Session time",
            placeholder = "07:30",
            error = if (draft.timeInvalid) "Use a 24-hour time, like 07:30" else null,
        )
    }
}
