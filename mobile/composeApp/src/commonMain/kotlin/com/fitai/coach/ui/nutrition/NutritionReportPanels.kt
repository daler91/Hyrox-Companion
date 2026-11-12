package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.GetNutritionMicrosResponse
import com.fitai.coach.core.api.generated.GetNutritionSummaryResponse
import com.fitai.coach.ui.analytics.LastUpdated
import com.fitai.coach.ui.analytics.Notice
import com.fitai.coach.ui.analytics.PanelTitle
import com.fitai.coach.ui.components.ButtonSize
import com.fitai.coach.ui.components.ButtonVariant
import com.fitai.coach.ui.components.FitaiButton
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.components.LoadingState
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.markdown.MarkdownText
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing
import kotlin.math.roundToLong

/**
 * The day's energy in against out (EnergyBalanceCard.tsx). "Out" counts the
 * training calories a device measured when there are any, and says so; the
 * server leaves the block out when the profile can't support an estimate.
 */
@Composable
fun EnergyBalanceCard(energy: GetNutritionSummaryResponse.Energy) {
    var explained by remember { mutableStateOf(false) }
    val surplus = energy.balanceKcal >= 0
    FitaiCard(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(LucideIcons.Scale, contentDescription = null, tint = FitaiTheme.colors.textMuted, modifier = Modifier.size(16.dp))
            Column(Modifier.weight(1f).padding(start = Spacing.Sm)) {
                Text("Energy balance", style = FitaiTheme.typography.h3, color = FitaiTheme.colors.text)
                Text(
                    if (energy.basis == GetNutritionSummaryResponse.Energy.Basis.Measured) {
                        "Training burn from your logged workouts"
                    } else {
                        "Estimated from your activity level"
                    },
                    style = FitaiTheme.typography.bodySm,
                    color = FitaiTheme.colors.textMuted,
                )
            }
            if (energy.explanation.isNotBlank()) {
                IconButton(onClick = { explained = !explained }) {
                    Icon(
                        LucideIcons.Info,
                        contentDescription = if (explained) "Hide how energy balance is worked out" else "How energy balance is worked out",
                        tint = FitaiTheme.colors.textMuted,
                    )
                }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            EnergyFigure(whole(energy.inKcal), "in (kcal)", Modifier.weight(1f))
            EnergyFigure(whole(energy.outKcal), "out (kcal)", Modifier.weight(1f))
            EnergyFigure(
                (if (surplus) "+" else "") + whole(energy.balanceKcal),
                "balance",
                Modifier.weight(1f),
                if (surplus) FitaiTheme.colors.warning else FitaiTheme.colors.accentText,
            )
        }
        if (explained) Text(energy.explanation, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

@Composable
private fun EnergyFigure(value: String, label: String, modifier: Modifier, color: Color = FitaiTheme.colors.text) {
    Column(modifier.clearAndSetSemantics { contentDescription = "$label $value" }, horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, style = FitaiTheme.typography.metric, color = color, textAlign = TextAlign.Center)
        Text(label, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

private fun whole(kcal: Double): String = formatNumber(kcal.roundToLong().toDouble())

/**
 * The day's micronutrients against reference intakes (MicronutrientPanel.tsx).
 * Only the micros the day's foods carry data for are listed; most foods have
 * none until they're fetched again, which the empty state says.
 */
@Composable
fun MicronutrientPanel(state: MicrosState) {
    val rows = state.rows.orEmpty()
    FitaiCard(Modifier.fillMaxWidth()) {
        PanelTitle("Micronutrients")
        when {
            rows.isEmpty() && state.loading -> Text("Loading…", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
            rows.isEmpty() -> Text(
                "No micronutrient data yet. Search for a food again to pull its micros from USDA or Open Food Facts.",
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.textMuted,
            )
            else -> Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                rows.chunked(2).forEach { pair ->
                    Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                        pair.forEach { MicroRow(it, Modifier.weight(1f)) }
                        if (pair.size == 1) Column(Modifier.weight(1f)) {}
                    }
                }
            }
        }
    }
}

/** One micronutrient: its %RDI, a bar (green at 100% or more), and the amount against the RDI (MicroRow.tsx). */
@Composable
private fun MicroRow(micro: GetNutritionMicrosResponse.MicrosItem, modifier: Modifier) {
    val unit = micro.unit.wireValue
    val amounts = "${formatNumber(micro.amount)} / ${formatNumber(micro.rdi)} $unit"
    Column(
        modifier.clearAndSetSemantics {
            contentDescription = "${micro.label}: ${formatNumber(micro.amount)} of ${formatNumber(micro.rdi)} $unit, " +
                "${micro.pctRdi}% of daily intake"
        },
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                micro.label,
                style = FitaiTheme.typography.bodySm,
                color = FitaiTheme.colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f),
            )
            Text("${micro.pctRdi}%", style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
        }
        LinearProgressIndicator(
            progress = { (micro.pctRdi.coerceAtMost(FULL_PCT) / FULL_PCT.toFloat()) },
            modifier = Modifier.fillMaxWidth(),
            color = if (micro.pctRdi >= FULL_PCT) FitaiTheme.colors.success else FitaiTheme.colors.primary,
            trackColor = FitaiTheme.colors.muted,
            // A plain bar, as on the web: no gap or end-of-track dot.
            gapSize = 0.dp,
            drawStopIndicator = {},
        )
        Text(amounts, style = FitaiTheme.typography.bodySm, color = FitaiTheme.colors.textMuted)
    }
}

private const val FULL_PCT = 100L

/**
 * The AI's reading of recent fuelling against training and targets
 * (NutritionInsightsPanel.tsx): the stored analysis shows at once, Generate
 * runs a new one. With the AI Coach off, Generate is off and the panel says
 * where to turn it on.
 */
@Composable
fun NutritionInsightsPanel(state: NutritionInsightsState, timeZone: String?, onGenerate: () -> Unit, openSettings: () -> Unit) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            PanelTitle("Nutrition Insights", LucideIcons.Sparkles)
            Text(
                "AI analysis of your recent fuelling against your training load and targets.",
                style = type.bodySm,
                color = colors.textMuted,
            )
            FitaiButton(
                when {
                    state.generating -> "Analyzing…"
                    state.hasInsights -> "Regenerate"
                    else -> "Generate insights"
                },
                onClick = onGenerate,
                variant = if (state.hasInsights) ButtonVariant.Secondary else ButtonVariant.Primary,
                size = ButtonSize.Sm,
                enabled = !state.generating && !state.aiCoachOff,
                leadingIcon = if (state.hasInsights) LucideIcons.RotateCw else LucideIcons.Sparkles,
            )
            LastUpdated(state.insights?.generatedAt, state.insights?.stale, timeZone)
            if (state.aiCoachOff) {
                Notice("The AI Coach is turned off. Enable it in Settings to get personalized nutrition insights.") {
                    FitaiButton("Enable AI Coach", onClick = openSettings, variant = ButtonVariant.Secondary, size = ButtonSize.Sm)
                }
            }
            state.error?.let { Text(it, style = type.body, color = colors.danger) }
            when {
                state.hasInsights -> MarkdownText(state.insights?.insights.orEmpty())
                state.generating || state.loading -> LoadingState(
                    Modifier.fillMaxWidth(),
                    message = "Reviewing your recent intake, training load, and targets…",
                )
                !state.aiCoachOff && state.error == null -> Text(
                    "Generate a personalized analysis of your fuelling: how your intake tracks your training, where you're falling " +
                        "short, and what to focus on next.",
                    style = type.body,
                    color = colors.textMuted,
                )
            }
        }
    }
}
