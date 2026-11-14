package com.fitai.coach.ui.nutrition

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.GetNutritionMicrosResponse
import com.fitai.coach.core.api.generated.NutritionMacroTotals
import com.fitai.coach.ui.components.FitaiChip
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.theme.DataColors
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private enum class PreviewTab { Summary, Nutrients }

/** The macro slices' colours (the web's chart-1 to chart-3), shared by the ring and the macro bars. */
private val ProteinColor get() = DataColors[0]
private val CarbColor get() = DataColors[1]
private val FatColor get() = DataColors[2]

private const val FULL_CIRCLE = 360f
private const val START_ANGLE = -90f
private const val PERCENT = 100f

/**
 * The serving as it would log (LogFoodDialog's LogPreviewTabs): its calorie
 * split, macros and effect on the day's goals under Summary, and its
 * vitamins and minerals under Nutrients.
 */
@Composable
fun LogPreview(serving: NutritionMacroTotals, goals: List<GoalContributionRow>, micros: List<GetNutritionMicrosResponse.MicrosItem>) {
    var tab by rememberSaveable { mutableStateOf(PreviewTab.Summary) }
    val shares = macroEnergyShares(serving)
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            FitaiChip("Summary", selected = tab == PreviewTab.Summary, onClick = { tab = PreviewTab.Summary })
            FitaiChip("Nutrients", selected = tab == PreviewTab.Nutrients, onClick = { tab = PreviewTab.Nutrients })
        }
        when (tab) {
            PreviewTab.Summary -> {
                CalorieRing(shares, serving.calories)
                MacroRows(serving, shares)
                GoalRows(goals)
            }
            PreviewTab.Nutrients -> MicroPreview(micros)
        }
    }
}

/**
 * The calorie-breakdown ring (CalorieBreakdownRing): each macro's share of the
 * serving's energy around the label calories, with a legend.
 */
@Composable
private fun CalorieRing(shares: MacroEnergyShares, calories: Double) {
    val colors = FitaiTheme.colors
    val slices = listOf(
        Triple("Protein", shares.protein, ProteinColor),
        Triple("Carbs", shares.carb, CarbColor),
        Triple("Fat", shares.fat, FatColor),
    )
    Row(
        Modifier.fillMaxWidth().background(colors.muted.copy(alpha = 0.4f), RoundedCornerShape(8.dp)),
        horizontalArrangement = Arrangement.spacedBy(Spacing.Lg, Alignment.CenterHorizontally),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(
            Modifier.size(120.dp).clearAndSetSemantics {
                contentDescription = "Calorie breakdown: protein ${shares.protein.pct}%, carbs ${shares.carb.pct}%, fat ${shares.fat.pct}%"
            },
            contentAlignment = Alignment.Center,
        ) {
            Canvas(Modifier.size(104.dp)) {
                val stroke = 14.dp.toPx()
                val inset = stroke / 2
                val arcSize = Size(size.width - stroke, size.height - stroke)
                drawArc(
                    colors.muted,
                    0f,
                    FULL_CIRCLE,
                    useCenter = false,
                    topLeft = Offset(inset, inset),
                    size = arcSize,
                    style = Stroke(stroke),
                )
                if (shares.totalKcal > 0) {
                    var start = START_ANGLE
                    slices.forEach { (_, share, color) ->
                        val sweep = (share.kcal / shares.totalKcal * FULL_CIRCLE).toFloat()
                        if (sweep > 0) {
                            drawArc(
                                color,
                                start,
                                sweep,
                                useCenter = false,
                                topLeft = Offset(inset, inset),
                                size = arcSize,
                                style = Stroke(stroke),
                            )
                        }
                        start += sweep
                    }
                }
            }
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(formatNumber(calories), style = FitaiTheme.typography.h3, color = colors.text)
                Text("KCAL", style = FitaiTheme.typography.label, color = colors.textMuted)
            }
        }
        Column(Modifier.width(140.dp), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
            slices.forEach { (label, share, color) ->
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Box(Modifier.size(10.dp).background(color, CircleShape))
                    Text(label, style = FitaiTheme.typography.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
                    Text("${share.pct}%", style = FitaiTheme.typography.label, color = colors.text)
                }
            }
        }
    }
}

/** The serving's calories, then each macro's grams and share of energy, and fibre against its Daily Value (MacroRows). */
@Composable
private fun MacroRows(serving: NutritionMacroTotals, shares: MacroEnergyShares) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("Calories", style = FitaiTheme.typography.body, color = colors.textMuted, modifier = Modifier.weight(1f))
            Text(formatNumber(serving.calories), style = FitaiTheme.typography.h2, color = colors.text)
        }
        MacroRow("Protein", serving.protein, "${shares.protein.pct}% energy", shares.protein.pct.toFloat(), ProteinColor)
        MacroRow("Carbs", serving.carb, "${shares.carb.pct}% energy", shares.carb.pct.toFloat(), CarbColor)
        MacroRow("Fat", serving.fat, "${shares.fat.pct}% energy", shares.fat.pct.toFloat(), FatColor)
        MacroRow(
            "Fiber",
            serving.fiber,
            "of ${formatNumber(FIBER_DV_G)} g",
            (serving.fiber / FIBER_DV_G * PERCENT).toFloat(),
            colors.primary,
        )
    }
}

@Composable
private fun MacroRow(label: String, grams: Double, note: String, barPct: Float, color: Color) {
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xxs)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            Text(label, style = FitaiTheme.typography.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
            Text("${formatNumber(grams)} g", style = FitaiTheme.typography.label, color = colors.text)
            Text(note, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
        Bar(listOf(barPct to color), height = 4)
    }
}

/**
 * "Effect on today's goals" (GoalContributionRows): each macro with a goal,
 * from today's percentage to where the serving takes it, the added part of
 * the bar amber once it goes over. Nothing without goals.
 */
@Composable
private fun GoalRows(rows: List<GoalContributionRow>) {
    if (rows.isEmpty()) return
    val colors = FitaiTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(
            "Effect on today's goals",
            style = FitaiTheme.typography.label,
            color = colors.textMuted,
            modifier = Modifier.semantics {
                heading()
            },
        )
        rows.forEach { row ->
            val over = row.projectedPct > FULL_PCT
            val (base, added) = goalBarSegments(row)
            Column(
                Modifier.clearAndSetSemantics {
                    contentDescription = "${row.macro.label}: ${row.currentPct}% to ${row.projectedPct}%, " +
                        "${formatNumber(row.projected)} of ${formatNumber(row.target)}"
                },
                verticalArrangement = Arrangement.spacedBy(Spacing.Xxs),
            ) {
                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Text(row.macro.label, style = FitaiTheme.typography.bodySm, color = colors.textMuted, modifier = Modifier.weight(1f))
                    Text("${row.currentPct}% → ", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
                    Text("${row.projectedPct}%", style = FitaiTheme.typography.label, color = if (over) colors.warning else colors.text)
                    Text(
                        "${formatNumber(row.projected)} / ${formatNumber(row.target)}",
                        style = FitaiTheme.typography.bodySm,
                        color = colors.textMuted,
                    )
                }
                Bar(listOf(base.toFloat() to colors.primary, added.toFloat() to if (over) colors.warning else colors.success), height = 6)
            }
        }
    }
}

/** A thin track filled by [segments] (percent of the width, colour), left to right. */
@Composable
private fun Bar(segments: List<Pair<Float, Color>>, height: Int) {
    val track = FitaiTheme.colors.muted
    Canvas(Modifier.fillMaxWidth().height(height.dp).clip(RoundedCornerShape(height.dp))) {
        drawRect(track)
        var x = 0f
        segments.forEach { (pct, color) ->
            val width = (size.width * pct / PERCENT).coerceIn(0f, size.width - x)
            if (width > 0f) drawRect(color, topLeft = Offset(x, 0f), size = Size(width, size.height))
            x += width
        }
    }
}

/**
 * The serving's vitamins and minerals with their %RDI, minerals first
 * (MicronutrientPreviewPanel). Only what the food has data for.
 */
@Composable
private fun MicroPreview(rows: List<GetNutritionMicrosResponse.MicrosItem>) {
    val colors = FitaiTheme.colors
    if (rows.isEmpty()) {
        Text("No micronutrient data for this food yet.", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
        MicroGroup("Minerals", rows.filter { it.key in MINERAL_KEYS })
        MicroGroup("Vitamins", rows.filterNot { it.key in MINERAL_KEYS })
    }
}

@Composable
private fun MicroGroup(title: String, rows: List<GetNutritionMicrosResponse.MicrosItem>) {
    if (rows.isEmpty()) return
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
        Text(title, style = FitaiTheme.typography.label, color = FitaiTheme.colors.textMuted, modifier = Modifier.semantics { heading() })
        rows.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
                pair.forEach { MicroRow(it, Modifier.weight(1f)) }
                if (pair.size == 1) Column(Modifier.weight(1f)) {}
            }
        }
    }
}

private const val FULL_PCT = 100
