package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.theme.FitaiTheme

private const val BAR_GAP = 0.25f
private const val DASH = 8f

/** A run of bars, [from] to [to] inclusive, shaded behind in [color] (an annotation's weeks). */
data class Shade(val from: Int, val to: Int, val color: Color)

/**
 * A bar chart drawn on a canvas: bars scaled to the largest value (or the
 * [goal], when higher), an optional dashed goal line, and bars that reach
 * the goal in the success colour, over any [shading]. Its description reads
 * out the values.
 */
@Composable
fun BarChart(
    bars: List<Bar>,
    label: String,
    modifier: Modifier = Modifier,
    goal: Double? = null,
    unit: String = "",
    shading: List<Shade> = emptyList(),
) {
    val colors = FitaiTheme.colors
    val max = maxOf(bars.maxOfOrNull { it.value } ?: 0.0, goal ?: 0.0).takeIf { it > 0 } ?: 1.0
    val description = "$label: " + bars.joinToString { "${shortDate(it.date)} ${formatNumber(it.value)}$unit" }
    Column(modifier.fillMaxWidth()) {
        Canvas(Modifier.fillMaxWidth().height(140.dp).semantics { contentDescription = description }) {
            if (bars.isEmpty()) return@Canvas
            val slot = size.width / bars.size
            val barWidth = slot * (1 - BAR_GAP)
            shading.forEach { shade ->
                drawRect(shade.color, Offset(shade.from * slot, 0f), Size((shade.to - shade.from + 1) * slot, size.height))
            }
            bars.forEachIndexed { i, bar ->
                val h = (bar.value / max * size.height).toFloat()
                drawRoundRect(
                    color = if (goal != null && bar.value >= goal) colors.success else colors.primary,
                    topLeft = Offset(i * slot + (slot - barWidth) / 2, size.height - h),
                    size = Size(barWidth, h),
                    cornerRadius = CornerRadius(4f, 4f),
                )
            }
            goal?.let {
                val y = (size.height - it / max * size.height).toFloat()
                drawLine(
                    colors.textMuted,
                    Offset(0f, y),
                    Offset(size.width, y),
                    strokeWidth = 2f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH, DASH)),
                )
            }
        }
        if (bars.isNotEmpty()) {
            Row(Modifier.fillMaxWidth()) {
                Text(
                    shortDate(bars.first().date),
                    style = FitaiTheme.typography.bodySm,
                    color = colors.textMuted,
                    modifier = Modifier.weight(1f),
                )
                Text(shortDate(bars.last().date), style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
        }
    }
}
