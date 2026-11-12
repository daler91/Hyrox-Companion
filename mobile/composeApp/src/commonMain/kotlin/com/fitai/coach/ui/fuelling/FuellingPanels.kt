package com.fitai.coach.ui.fuelling

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.GetNutritionSessionFuellingByWorkoutIdResponse
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

/**
 * What was eaten either side of a logged workout against what the session
 * called for (FuellingAroundSessionPanel.tsx): the pre-session (carb-forward)
 * and post-session (recovery) windows, how far each is from its target, and,
 * while recovery fuel is still owed, the way to log it.
 */
@Composable
fun FuellingAroundSessionPanel(fuelling: GetNutritionSessionFuellingByWorkoutIdResponse?, onLogRecovery: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            FuellingTitle("Fuelling around this session")
            if (fuelling == null) {
                Text("Loading…", style = type.bodySm, color = colors.textMuted)
                return@Column
            }
            val target = fuelling.target
            val gap = fuelling.gap
            FuellingGroup("Pre-session fuelling", fuelling.pre.size, fuelling.preTotals, emphasizeProtein = false) {
                PreCarbTargetLine(target.preCarbG, remaining = gap.preCarbG, showRemaining = true)
            }
            FuellingGroup("Post-session recovery", fuelling.post.size, fuelling.postTotals, emphasizeProtein = true) {
                PostTargetLine(target.postCarbG, target.postProteinG, carbRemaining = gap.postCarbG, proteinRemaining = gap.postProteinG)
            }
            if (gap.postCarbG > 0 || gap.postProteinG > 0) {
                FitaiButton(
                    "Log recovery meal",
                    onClick = onLogRecovery,
                    variant = ButtonVariant.Secondary,
                    size = ButtonSize.Sm,
                    leadingIcon = LucideIcons.UtensilsCrossed,
                )
            }
            FuellingGuidanceNote(target.explanation)
            if (!fuelling.usedStartTime) {
                Text(
                    "Based on your pre/post-workout meal tags. Connect Strava or Garmin for exact session timing.",
                    style = type.bodySm,
                    color = colors.textMuted,
                )
            }
        }
    }
}

@Composable
internal fun FuellingTitle(text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Icon(LucideIcons.UtensilsCrossed, contentDescription = null, tint = FitaiTheme.colors.textMuted, modifier = Modifier.size(16.dp))
        Text(text, style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
    }
}

/** One window's food: how many items, their macros, and the target line under them. */
@Composable
private fun FuellingGroup(
    title: String,
    count: Int,
    totals: NutritionMacroTotals,
    emphasizeProtein: Boolean,
    targetLine: @Composable () -> Unit,
) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        val items = when (count) {
            0 -> ""
            1 -> " · 1 item"
            else -> " · $count items"
        }
        Text("$title$items", style = type.label, color = colors.textMuted)
        if (count >
            0
        ) {
            MacroChips(title, totals, emphasizeProtein)
        } else {
            Text("Nothing logged", style = type.bodySm, color = colors.textMuted)
        }
        targetLine()
    }
}

/** Calories, protein, carbs and fat as small chips, protein picked out in the recovery window. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun MacroChips(title: String, totals: NutritionMacroTotals, emphasizeProtein: Boolean) {
    val described = "$title: ${formatNumber(totals.calories)} kcal, ${grams(totals.protein)} g protein, " +
        "${grams(totals.carb)} g carbs, ${grams(totals.fat)} g fat"
    FlowRow(
        Modifier.clearAndSetSemantics { contentDescription = described },
        horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        MacroChip(formatNumber(totals.calories), "kcal")
        MacroChip(grams(totals.protein), "P", emphasized = emphasizeProtein)
        MacroChip(grams(totals.carb), "C")
        MacroChip(grams(totals.fat), "F")
    }
}

@Composable
private fun MacroChip(value: String, label: String, emphasized: Boolean = false) {
    val colors = FitaiTheme.colors
    val background = if (emphasized) colors.accentSoft else colors.muted
    val valueColor = if (emphasized) colors.onAccentSoft else colors.text
    Text(
        buildAnnotatedString {
            withStyle(SpanStyle(fontWeight = if (emphasized) FontWeight.SemiBold else FontWeight.Medium, color = valueColor)) {
                append(value)
            }
            append(" $label")
        },
        style = FitaiTheme.typography.bodySm,
        color = if (emphasized) colors.onAccentSoft else colors.textMuted,
        modifier = Modifier.background(background, Radius.Sm).padding(horizontal = Spacing.Sm, vertical = 2.dp),
    )
}

/** "Aim ~30g carbs", with what's left when [showRemaining]; "No pre-fuelling needed" for a session that doesn't call for any. */
@Composable
internal fun PreCarbTargetLine(preCarbG: Double, remaining: Double? = null, showRemaining: Boolean = false) {
    val colors = FitaiTheme.colors
    if (preCarbG <= 0) {
        Text("No pre-fuelling needed", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        return
    }
    val suffix = if (showRemaining) " (${gapText(remaining)})" else ""
    TargetText(
        buildAnnotatedString {
            append("Aim ~")
            strong(colors.text, "${grams(preCarbG)}g")
            append(" carbs$suffix")
        },
    )
}

/** "Aim ~60g carbs · ~25g protein", each with what's left when the remainders are given. */
@Composable
internal fun PostTargetLine(postCarbG: Double, postProteinG: Double, carbRemaining: Double? = null, proteinRemaining: Double? = null) {
    val colors = FitaiTheme.colors
    val showRemaining = carbRemaining != null || proteinRemaining != null
    TargetText(
        buildAnnotatedString {
            append("Aim ~")
            strong(colors.text, "${grams(postCarbG)}g")
            append(" carbs")
            if (showRemaining) append(" (${gapText(carbRemaining)})")
            append(" · ~")
            strong(colors.text, "${grams(postProteinG)}g")
            append(" protein")
            if (showRemaining) append(" (${gapText(proteinRemaining)})")
        },
    )
}

@Composable
private fun TargetText(text: AnnotatedString) {
    Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
}

private fun AnnotatedString.Builder.strong(color: Color, text: String) {
    withStyle(SpanStyle(fontWeight = FontWeight.Medium, color = color)) { append(text) }
}

/** The caveat under a set of session targets, with how they were worked out behind its info button (FuellingGuidanceNote.tsx). */
@Composable
internal fun FuellingGuidanceNote(explanation: String) {
    var open by remember(explanation) { mutableStateOf(false) }
    Column {
        ExplainedLine(
            "Targets are guidance based on this session.",
            open = open,
            showLabel = "How these targets are worked out",
            hideLabel = "Hide how these targets are worked out",
            onToggle = { open = !open },
        )
        if (open) Text(explanation, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

/** A muted line with an info button after it that shows or hides more. */
@Composable
internal fun ExplainedLine(text: String, open: Boolean, showLabel: String, hideLabel: String, onToggle: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted, modifier = Modifier.weight(1f, fill = false))
        IconButton(onClick = onToggle) {
            Icon(LucideIcons.Info, contentDescription = if (open) hideLabel else showLabel, tint = FitaiTheme.colors.textMuted)
        }
    }
}

/**
 * A day's fuelling beside its date on the timeline (FuellingDayChip.tsx):
 * calories against the day's target (amber once past it), protein against
 * its own, and a tick when a post-workout meal was logged. Opens the day in
 * Nutrition.
 */
@Composable
fun FuellingDayChip(day: DayFuelling, onClick: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val open = onClick
    Surface(
        onClick = open,
        // One button that reads the day out in words, not the figures it shows.
        modifier = Modifier.clearAndSetSemantics {
            contentDescription = day.description
            role = Role.Button
            onClick {
                open()
                true
            }
        },
        shape = Radius.Md,
        color = colors.card,
        border = BorderStroke(1.dp, colors.border),
    ) {
        Row(
            Modifier.padding(horizontal = Spacing.Sm, vertical = Spacing.Xs),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Spacing.Xs),
        ) {
            Icon(LucideIcons.Flame, contentDescription = null, tint = colors.textMuted, modifier = Modifier.size(14.dp))
            Text(
                buildAnnotatedString {
                    strong(if (day.caloriesOver) colors.warning else colors.text, day.calories.toString())
                    day.caloriesTarget?.let { append("/$it") }
                },
                style = type.bodySm,
                color = colors.textMuted,
            )
            if (day.protein != null && day.proteinTarget != null) {
                Text(
                    buildAnnotatedString {
                        append("P ")
                        strong(colors.text, grams(day.protein))
                        append("/${grams(day.proteinTarget)}")
                    },
                    style = type.bodySm,
                    color = colors.textMuted,
                )
            }
            if (day.postWorkoutLogged) {
                Icon(
                    LucideIcons.Check,
                    contentDescription = null,
                    tint = colors.accentText,
                    modifier = Modifier.size(14.dp),
                )
            }
        }
    }
}
