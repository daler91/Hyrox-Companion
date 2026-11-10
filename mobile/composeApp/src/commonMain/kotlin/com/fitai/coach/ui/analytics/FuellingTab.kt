package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.GetNutritionBlockResponse
import com.fitai.coach.ui.components.EmptyState
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val BAR_ALPHA = 0.75f
private const val BAR_GAP = 0.2f
private const val LINE_WIDTH = 4f
private const val TOP_INSET = 12f

/** The Fuelling tab (FuellingTab): daily intake against training load over the range, and how fuelling lines up with sessions. */
fun LazyListScope.fuelling(block: GetNutritionBlockResponse) {
    if (!hasIntake(block.points)) {
        item {
            EmptyState(
                title = "No nutrition logged in this range",
                message = "Log food on the Nutrition page to see how your daily intake tracks against training load.",
            )
        }
        return
    }
    item { IntakeVsTrainingCard(block.points) }
    item { FuellingCorrelationCard(block.points) }
}

@Composable
private fun IntakeVsTrainingCard(points: List<GetNutritionBlockResponse.PointsItem>) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Column {
                ChartTitle("Intake vs training load")
                Text("Daily calories (bars) against training UTSS (line)", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
            if (points.size > 1) {
                IntakeChart(points)
            } else {
                Text(
                    "Log food across a few training days to see intake against load.",
                    style = FitaiTheme.typography.bodySm,
                    color = colors.textMuted,
                )
            }
        }
    }
}

/** Calories as bars and UTSS as a line, each on its own scale (the web's two axes). */
@Composable
private fun IntakeChart(points: List<GetNutritionBlockResponse.PointsItem>) {
    val colors = FitaiTheme.colors
    val calorieColor = colors.primary.copy(alpha = BAR_ALPHA)
    val loadColor = seriesColor(SeriesColor.Green, colors)
    val maxCalories = points.maxOf { it.calories }.takeIf { it > 0 } ?: 1.0
    val maxLoad = points.maxOf { it.utss }.takeIf { it > 0 } ?: 1.0
    val description = "Daily calorie intake against training UTSS over ${points.size} days, ${shortDate(points.first().date)} to " +
        "${shortDate(points.last().date)}: up to ${formatLoad(maxCalories)} kcal and UTSS ${formatLoad(maxLoad)}"
    Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Row(horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Swatch(calorieColor, "Calories (up to ${formatLoad(maxCalories)} kcal)")
            Swatch(loadColor, "UTSS (up to ${formatLoad(maxLoad)})")
        }
        Canvas(Modifier.fillMaxWidth().height(160.dp).semantics { contentDescription = description }) {
            val slot = size.width / points.size
            val barWidth = (slot * (1 - BAR_GAP)).coerceAtLeast(1f)
            // Headroom, so the line at its peak doesn't run along the top edge.
            val plotHeight = size.height - TOP_INSET
            points.forEachIndexed { i, point ->
                val h = (point.calories / maxCalories * plotHeight).toFloat()
                if (h > 0) drawRect(calorieColor, Offset(i * slot + (slot - barWidth) / 2, size.height - h), Size(barWidth, h))
            }
            val path = Path()
            points.forEachIndexed { i, point ->
                val x = i * slot + slot / 2
                val y = (size.height - point.utss / maxLoad * plotHeight).toFloat()
                if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
            }
            drawPath(path, loadColor, style = Stroke(width = LINE_WIDTH, join = StrokeJoin.Round))
        }
        Row(Modifier.fillMaxWidth()) {
            Text(
                shortDate(points.first().date),
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
                modifier = Modifier.weight(1f),
            )
            Text(shortDate(points.last().date), style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
    }
}

/**
 * Session RPE and compliance on carb-hit days against missed days; nothing
 * until a day has food, a carb target and an outcome (FuellingCorrelationCard).
 */
@Composable
private fun FuellingCorrelationCard(points: List<GetNutritionBlockResponse.PointsItem>) {
    val result = remember(points) { fuellingCorrelation(points) }
    if (result.eligibleDays == 0) return
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Sm)) {
            ChartTitle("Fuelling and performance")
            if (result.ok) {
                result.rpe?.let { Comparison("Session RPE", comparisonLine(it, ::formatNumber, rpeDeltaText(it))) }
                result.compliance?.let {
                    Comparison("Workout compliance", comparisonLine(it, { n -> "${formatNumber(n)}%" }, complianceDeltaText(it)))
                }
                Text(
                    "${result.eligibleDays} training days with food logged compared (carb target hit = ≥${result.carbHitPct}% of " +
                        "that day's target). Association, not causation.",
                    style = type.bodySm,
                    color = colors.textMuted,
                )
            } else {
                Text(
                    "Not enough overlap yet between carb-target days and recorded RPE or compliance — keep logging food and workouts " +
                        "to unlock this comparison.",
                    style = type.body,
                    color = colors.textMuted,
                )
            }
            Text(FUELLING_EXPLANATION, style = type.bodySm, color = colors.textMuted)
        }
    }
}

@Composable
private fun Comparison(label: String, line: String) {
    Column {
        Text(label, style = FitaiTheme.typography.label, color = FitaiTheme.colors.text)
        Text(line, style = FitaiTheme.typography.body, color = FitaiTheme.colors.textMuted)
    }
}
