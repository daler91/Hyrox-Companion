package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.fitai.coach.ui.format.formatNumber
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.theme.DataColors
import com.fitai.coach.ui.theme.FitaiColors
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Spacing

private const val DASH = 8f
private const val LINE_WIDTH = 4f
private const val DOT_RADIUS = 3f
private const val BAND_ALPHA = 0.14f
private const val INSET = 8f
private const val LABEL_GAP = 2f

/** A series colour on this theme: the primary, or one of the data-viz hues. */
@Suppress("MagicNumber")
fun seriesColor(color: SeriesColor, colors: FitaiColors): Color = when (color) {
    SeriesColor.Primary -> colors.primary
    SeriesColor.Blue -> DataColors[0]
    SeriesColor.Green -> DataColors[1]
    SeriesColor.Amber -> DataColors[2]
    SeriesColor.Red -> DataColors[3]
    SeriesColor.Purple -> DataColors[4]
}

/**
 * A line chart on a canvas, one line per series against a shared date axis.
 * [bands] shade value ranges behind the lines (the ACWR zones) and
 * [references] draw dashed rules; [top] fixes the axis's top. Its
 * description reads each line's latest value and range, and the dates.
 */
@Composable
fun LineChart(
    series: List<LineSeries>,
    label: String,
    modifier: Modifier = Modifier,
    bands: List<ZoneBand> = emptyList(),
    references: List<Reference> = emptyList(),
    top: Double? = null,
    format: (Double) -> String = ::formatNumber,
) {
    val colors = FitaiTheme.colors
    val measurer = rememberTextMeasurer()
    val dates = series.flatMap { line -> line.points.map { it.date } }.distinct().sorted()
    val axis = Axis.of(series, bands, references, top)
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        if (series.size > 1) Legend(series)
        Canvas(Modifier.fillMaxWidth().height(150.dp).semantics { contentDescription = describe(label, series, dates, format) }) {
            if (dates.isEmpty()) return@Canvas
            val style = TextStyle(fontSize = 10.sp, color = colors.textMuted)
            val topLabel = measurer.measure(format(axis.max), style)
            val bottomLabel = measurer.measure(format(axis.min), style)
            // The axis numbers get a gutter of their own, so no line runs through them.
            val plot = Plot(size, axis, dates, left = (maxOf(topLabel.size.width, bottomLabel.size.width) + GUTTER_GAP).toFloat())
            bands.forEach { band ->
                val y1 = plot.y(band.to)
                drawRect(
                    seriesColor(band.color, colors).copy(alpha = BAND_ALPHA),
                    Offset(plot.left, y1),
                    Size(size.width - plot.left, plot.y(band.from) - y1),
                )
            }
            references.forEach { drawReference(it, plot, colors, measurer) }
            series.forEach { drawLine(it, plot, seriesColor(it.color, colors)) }
            drawText(topLabel, topLeft = Offset(0f, (plot.y(axis.max) - topLabel.size.height / 2f).coerceAtLeast(0f)))
            drawText(
                bottomLabel,
                topLeft = Offset(0f, (plot.y(axis.min) - bottomLabel.size.height / 2f).coerceAtMost(size.height - bottomLabel.size.height)),
            )
        }
        if (dates.isNotEmpty()) {
            Row(Modifier.fillMaxWidth()) {
                Text(
                    shortDate(dates.first()),
                    style = FitaiTheme.typography.bodySm,
                    color = colors.textMuted,
                    modifier = Modifier.weight(1f),
                )
                Text(shortDate(dates.last()), style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun Legend(series: List<LineSeries>) {
    val colors = FitaiTheme.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Md), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        series.forEach { line ->
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Box(Modifier.size(8.dp).background(seriesColor(line.color, colors), CircleShape))
                Text(line.label, style = FitaiTheme.typography.bodySm, color = colors.textMuted)
            }
        }
    }
}

/** The value axis: from zero (or the lowest value) to the highest, or [top]. */
private data class Axis(val min: Double, val max: Double) {
    companion object {
        fun of(series: List<LineSeries>, bands: List<ZoneBand>, references: List<Reference>, top: Double?): Axis {
            val values = series.flatMap { line -> line.points.map { it.value } } + references.map { it.value }
            val low = minOf(0.0, values.minOrNull() ?: 0.0)
            val high = top ?: maxOf(values.maxOrNull() ?: 0.0, bands.maxOfOrNull { it.to } ?: 0.0)
            return Axis(low, if (high > low) high else low + 1)
        }
    }
}

/** Where a date and a value land on the canvas, right of a [left] gutter. */
private class Plot(private val size: Size, private val axis: Axis, dates: List<String>, val left: Float) {
    private val index = dates.withIndex().associate { it.value to it.index }
    private val steps = (dates.size - 1).coerceAtLeast(1)

    fun x(date: String): Float {
        val i = index[date] ?: 0
        return if (index.size == 1) (left + size.width) / 2 else left + INSET + i * (size.width - left - 2 * INSET) / steps
    }

    fun y(value: Double): Float {
        val clamped = value.coerceIn(axis.min, axis.max)
        return (INSET + (axis.max - clamped) / (axis.max - axis.min) * (size.height - 2 * INSET)).toFloat()
    }
}

private fun DrawScope.drawLine(line: LineSeries, plot: Plot, color: Color) {
    val points = line.points.map { Offset(plot.x(it.date), plot.y(it.value)) }
    if (points.size > 1) {
        val path = Path().apply {
            moveTo(points.first().x, points.first().y)
            points.drop(1).forEach { lineTo(it.x, it.y) }
        }
        drawPath(path, color, style = Stroke(width = LINE_WIDTH, cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
    points.forEach { drawCircle(color, DOT_RADIUS, it) }
}

private const val GUTTER_GAP = 8

private fun DrawScope.drawReference(reference: Reference, plot: Plot, colors: FitaiColors, measurer: TextMeasurer) {
    val y = plot.y(reference.value)
    val color = reference.color?.let { seriesColor(it, colors) } ?: colors.textMuted
    drawLine(
        color,
        Offset(plot.left, y),
        Offset(size.width, y),
        strokeWidth = 2f,
        pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH, DASH)),
    )
    reference.label?.let {
        val text = measurer.measure(it, TextStyle(fontSize = 10.sp, color = color))
        // Above its rule, or below it when the rule is the chart's top.
        val above = y - text.size.height - LABEL_GAP
        drawText(text, topLeft = Offset(size.width - text.size.width, if (above >= 0) above else y + LABEL_GAP))
    }
}

private fun describe(label: String, series: List<LineSeries>, dates: List<String>, format: (Double) -> String): String {
    if (dates.isEmpty()) return "$label: no data"
    val lines = series.filter { it.points.isNotEmpty() }.joinToString("; ") { line ->
        val values = line.points.map { it.value }
        val name = if (series.size > 1) "${line.label} " else ""
        "${name}latest ${format(values.last())}, low ${format(values.min())}, high ${format(values.max())}"
    }
    return "$label, ${shortDate(dates.first())} to ${shortDate(dates.last())}: $lines"
}
