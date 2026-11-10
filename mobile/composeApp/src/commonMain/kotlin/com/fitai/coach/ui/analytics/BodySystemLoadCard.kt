package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.fitai.coach.core.api.generated.TrainingOverview
import com.fitai.coach.ui.components.BadgeTone
import com.fitai.coach.ui.components.FitaiBadge
import com.fitai.coach.ui.components.FitaiCard
import com.fitai.coach.ui.format.shortDate
import com.fitai.coach.ui.icons.generated.LucideIcons
import com.fitai.coach.ui.theme.FitaiTheme
import com.fitai.coach.ui.theme.Radius
import com.fitai.coach.ui.theme.Spacing

private const val BANNER_ALPHA = 0.12f
private const val PAST_WEEK_ALPHA = 0.45f
private const val BAR_GAP = 0.35f
private const val DASH = 6f
private const val MIN_BAR = 3f
private const val ZERO_BAR = 2f

/**
 * Load by body system: one training-load number split into the four systems
 * a hybrid athlete stresses, each read against its own usual week. The
 * divergence the single number hides leads the card.
 */
@Composable
fun BodySystemLoadCard(load: TrainingOverview.BodySystemLoad, explanation: String?) {
    val colors = FitaiTheme.colors
    FitaiCard(Modifier.fillMaxWidth()) {
        Column(verticalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Column {
                ChartTitle("Load by body system")
                Text(
                    "Session RPE × minutes, split by what each session trained. Rolling 7-day weeks.",
                    style = FitaiTheme.typography.bodySm,
                    color = colors.textMuted,
                )
            }
            bodySystemDivergence(load)?.let { DivergenceBanner(it) }
            load.systems.forEach { SystemTile(it, load.weeks) }
            Column(verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Swatch(colors.primary, "This week")
                Swatch(colors.textMuted.copy(alpha = PAST_WEEK_ALPHA), "Previous weeks")
                UsualWeekKey()
            }
            bodySystemNotes(load).forEach { Text(it, style = FitaiTheme.typography.bodySm, color = colors.textMuted) }
            ChartExplanation(explanation)
        }
    }
}

/** The dashed rule's key: the usual week. */
@Composable
private fun UsualWeekKey() {
    val colors = FitaiTheme.colors
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
        Canvas(Modifier.width(12.dp).height(10.dp)) {
            drawLine(
                colors.textMuted,
                Offset(0f, size.height / 2),
                Offset(size.width, size.height / 2),
                strokeWidth = 2f,
                pathEffect = PathEffect.dashPathEffect(floatArrayOf(KEY_DASH, KEY_DASH)),
            )
        }
        Text("Your usual week (average of the four before this one)", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
    }
}

private const val KEY_DASH = 4f

@Composable
private fun DivergenceBanner(divergence: Divergence) {
    val colors = FitaiTheme.colors
    val tint = if (divergence.severe) colors.danger else colors.warning
    Row(
        Modifier.fillMaxWidth().background(tint.copy(alpha = BANNER_ALPHA), Radius.Md).padding(Spacing.Md),
        horizontalArrangement = Arrangement.spacedBy(Spacing.Sm),
    ) {
        Icon(LucideIcons.Info, contentDescription = null, tint = tint, modifier = Modifier.size(16.dp))
        Text(divergence.text, style = FitaiTheme.typography.bodySm, color = colors.text, modifier = Modifier.weight(1f))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun SystemTile(system: TrainingOverview.BodySystemLoad.SystemsItem, weeks: List<TrainingOverview.BodySystemLoad.WeeksItem>) {
    val colors = FitaiTheme.colors
    val type = FitaiTheme.typography
    val (status, tone) = bodySystemStatus(system.status)
    Column(
        Modifier.fillMaxWidth().background(colors.muted, Radius.Md).padding(Spacing.Md),
        verticalArrangement = Arrangement.spacedBy(Spacing.Xs),
    ) {
        Text(bodySystemLabel(system.system), style = type.label, color = colors.text)
        Text(bodySystemDescription(system.system), style = type.bodySm, color = colors.textMuted)
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.Md)) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    Text(formatLoad(system.current), style = type.metric, color = colors.text)
                    Text("this week", style = type.bodySm, color = colors.textMuted)
                }
                FlowRow(horizontalArrangement = Arrangement.spacedBy(Spacing.Xs), verticalArrangement = Arrangement.spacedBy(Spacing.Xs)) {
                    FitaiBadge(status, tone = tone)
                    if (system.sixWeekHigh) FitaiBadge("6-week high", tone = BadgeTone.Warning)
                }
                bodySystemDetail(system).takeIf { it.isNotEmpty() }?.let { Text(it, style = type.bodySm, color = colors.textMuted) }
            }
            WeekBars(system, weeks, Modifier.width(112.dp))
        }
    }
}

/**
 * Six rolling weeks as thin columns: this week in the primary colour, the
 * five before it recessive, and the usual week as a dashed rule. Each system
 * has its own scale; it's compared with itself, never with the others.
 */
@Composable
private fun WeekBars(
    system: TrainingOverview.BodySystemLoad.SystemsItem,
    weeks: List<TrainingOverview.BodySystemLoad.WeeksItem>,
    modifier: Modifier,
) {
    val colors = FitaiTheme.colors
    val scale = maxOf(1.0, system.baseline ?: 0.0, system.weekly.maxOfOrNull { it ?: 0.0 } ?: 0.0)
    val described = system.weekly.withIndex().joinToString("; ") { (i, value) ->
        "${bodySystemWeekLabel(weeks, i)}: ${value?.let(::formatLoad) ?: "no history"}"
    }
    Column(modifier) {
        Canvas(
            Modifier.fillMaxWidth().height(56.dp).semantics {
                contentDescription = "${bodySystemLabel(system.system)} load over six weeks. $described."
            },
        ) {
            if (system.weekly.isEmpty()) return@Canvas
            val slot = size.width / system.weekly.size
            val barWidth = slot * (1 - BAR_GAP)
            system.weekly.forEachIndexed { i, value ->
                val left = i * slot + (slot - barWidth) / 2
                val height = when {
                    value == null -> 1f
                    value > 0 -> maxOf((value / scale * size.height).toFloat(), MIN_BAR)
                    else -> ZERO_BAR
                }
                val color = when {
                    value == null -> colors.border
                    i == system.weekly.lastIndex -> colors.primary
                    else -> colors.textMuted.copy(alpha = PAST_WEEK_ALPHA)
                }
                drawRoundRect(color, Offset(left, size.height - height), Size(barWidth, height), CornerRadius(2f, 2f))
            }
            system.baseline?.takeIf { it > 0 }?.let {
                val y = (size.height - it / scale * size.height).toFloat()
                drawLine(
                    colors.textMuted,
                    Offset(0f, y),
                    Offset(size.width, y),
                    strokeWidth = 2f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(DASH, DASH)),
                )
            }
        }
        Row(Modifier.fillMaxWidth()) {
            Text(
                weeks.firstOrNull()?.let { shortDate(it.start) }.orEmpty(),
                style = FitaiTheme.typography.bodySm,
                color = colors.textMuted,
                modifier = Modifier.weight(1f),
            )
            Text("This week", style = FitaiTheme.typography.bodySm, color = colors.textMuted)
        }
    }
}
