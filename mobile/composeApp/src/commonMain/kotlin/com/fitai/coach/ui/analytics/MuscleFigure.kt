package com.fitai.coach.ui.analytics

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import com.fitai.coach.core.api.generated.TrainingOverview.MuscleGroupCoverageItem.Muscle

/** One muscle zone on the figure, in the web's 120 × 330 viewBox (MUSCLE_SHAPES). */
private sealed interface Zone {
    val muscle: Muscle

    data class Oval(override val muscle: Muscle, val cx: Float, val cy: Float, val rx: Float, val ry: Float, val rotate: Float = 0f) : Zone

    data class Box(override val muscle: Muscle, val x: Float, val y: Float, val w: Float, val h: Float, val r: Float) : Zone

    data class Shape(override val muscle: Muscle, val d: String) : Zone
}

private const val VIEW_WIDTH = 120f
private const val VIEW_HEIGHT = 330f
private const val STROKE = 1.5f
private const val CLOSED_GUIDE_SHAPES = 3

@Suppress("MagicNumber") // The web figure's own coordinates (MuscleHeatMapCard.tsx).
private val FRONT: List<Zone> = listOf(
    Zone.Oval(Muscle.Shoulders, 38f, 66f, 15f, 12f, -18f),
    Zone.Oval(Muscle.Shoulders, 82f, 66f, 15f, 12f, 18f),
    Zone.Shape(Muscle.Chest, "M42 80 C46 70 56 68 60 78 L60 104 C51 103 43 98 38 89 Z"),
    Zone.Shape(Muscle.Chest, "M60 78 C64 68 74 70 78 80 L82 89 C77 98 69 103 60 104 Z"),
    Zone.Oval(Muscle.Biceps, 28f, 107f, 9f, 22f, 8f),
    Zone.Oval(Muscle.Biceps, 92f, 107f, 9f, 22f, -8f),
    Zone.Oval(Muscle.Forearms, 22f, 158f, 8f, 25f, 9f),
    Zone.Oval(Muscle.Forearms, 98f, 158f, 8f, 25f, -9f),
    Zone.Box(Muscle.Core, 48f, 107f, 24f, 44f, 8f),
    Zone.Shape(Muscle.Obliques, "M39 105 L49 109 L48 151 L38 145 C37 130 37 116 39 105 Z"),
    Zone.Shape(Muscle.Obliques, "M72 109 L81 105 C83 116 83 130 82 145 L72 151 Z"),
    Zone.Shape(Muscle.HipFlexors, "M43 156 L60 151 L77 156 L70 175 L50 175 Z"),
    Zone.Oval(Muscle.Quads, 49f, 216f, 12f, 40f),
    Zone.Oval(Muscle.Quads, 71f, 216f, 12f, 40f),
    Zone.Shape(Muscle.Adductors, "M55 177 L60 178 L60 247 L51 247 C51 221 52 198 55 177 Z"),
    Zone.Shape(Muscle.Adductors, "M60 178 L65 177 C68 198 69 221 69 247 L60 247 Z"),
    Zone.Oval(Muscle.Tibialis, 48f, 280f, 8f, 31f),
    Zone.Oval(Muscle.Tibialis, 72f, 280f, 8f, 31f),
    Zone.Oval(Muscle.Calves, 39f, 277f, 6f, 27f, -6f),
    Zone.Oval(Muscle.Calves, 81f, 277f, 6f, 27f, 6f),
)

@Suppress("MagicNumber")
private val BACK: List<Zone> = listOf(
    Zone.Shape(Muscle.Traps, "M47 56 L60 45 L73 56 L68 78 L52 78 Z"),
    Zone.Oval(Muscle.RearDelts, 39f, 76f, 13f, 11f, -18f),
    Zone.Oval(Muscle.RearDelts, 81f, 76f, 13f, 11f, 18f),
    Zone.Shape(Muscle.UpperBack, "M43 79 C50 74 70 74 77 79 L73 111 C65 116 55 116 47 111 Z"),
    Zone.Shape(Muscle.Lats, "M36 88 C43 96 48 110 48 132 L39 143 C34 124 32 105 36 88 Z"),
    Zone.Shape(Muscle.Lats, "M84 88 C88 105 86 124 81 143 L72 132 C72 110 77 96 84 88 Z"),
    Zone.Oval(Muscle.Triceps, 28f, 113f, 9f, 24f, 8f),
    Zone.Oval(Muscle.Triceps, 92f, 113f, 9f, 24f, -8f),
    Zone.Oval(Muscle.Forearms, 22f, 162f, 8f, 25f, 9f),
    Zone.Oval(Muscle.Forearms, 98f, 162f, 8f, 25f, -9f),
    Zone.Box(Muscle.LowerBack, 48f, 117f, 24f, 38f, 8f),
    Zone.Oval(Muscle.Glutes, 49f, 174f, 14f, 18f),
    Zone.Oval(Muscle.Glutes, 71f, 174f, 14f, 18f),
    Zone.Oval(Muscle.HipAbductors, 39f, 178f, 8f, 17f, 16f),
    Zone.Oval(Muscle.HipAbductors, 81f, 178f, 8f, 17f, -16f),
    Zone.Oval(Muscle.Hamstrings, 49f, 224f, 11f, 41f),
    Zone.Oval(Muscle.Hamstrings, 71f, 224f, 11f, 41f),
    Zone.Oval(Muscle.Calves, 48f, 283f, 10f, 31f),
    Zone.Oval(Muscle.Calves, 72f, 283f, 10f, 31f),
)

/** The faint body outline behind the zones (BodyGuide). */
@Suppress("MagicNumber")
private val GUIDE = listOf(
    "M60 8 A16 16 0 1 1 59.99 8 Z",
    "M57 39 L63 39 Q69 39 69 45 L69 50 Q69 56 63 56 L57 56 Q51 56 51 50 L51 45 Q51 39 57 39 Z",
    "M39 58 C51 53 69 53 81 58 C87 86 88 128 78 158 L60 169 L42 158 C32 128 33 86 39 58 Z",
    "M38 68 C20 85 17 132 19 185",
    "M82 68 C100 85 103 132 101 185",
    "M43 168 C38 207 38 261 43 318",
    "M77 168 C82 207 82 261 77 318",
)

private fun pathOf(d: String): Path = PathParser().parsePathString(d).toPath()

/**
 * The front or back of the body with each muscle zone filled by its
 * set-volume level (MuscleFigure). [heat] maps a muscle to its fill; the
 * figure reads out [description] for screen readers, since the colours alone
 * say nothing to them.
 */
@Composable
fun MuscleFigure(back: Boolean, heat: (Muscle) -> Color, outline: Color, guide: Color, description: String, modifier: Modifier = Modifier) {
    val zones = if (back) BACK else FRONT
    val paths = remember(back) { zones.filterIsInstance<Zone.Shape>().associateWith { pathOf(it.d) } }
    val guidePaths = remember { GUIDE.map(::pathOf) }
    Canvas(modifier.aspectRatio(VIEW_WIDTH / VIEW_HEIGHT).semantics { contentDescription = description }) {
        val s = size.width / VIEW_WIDTH
        scale(s, s, pivot = Offset.Zero) {
            // Head, neck and torso are shapes; the limbs are open lines, outlined only.
            guidePaths.take(CLOSED_GUIDE_SHAPES).forEach { drawPath(it, guide) }
            guidePaths.forEach { drawPath(it, outline, style = Stroke(STROKE)) }
            zones.forEach { zone -> drawZone(zone, heat(zone.muscle), outline, paths) }
        }
    }
}

private fun DrawScope.drawZone(zone: Zone, fill: Color, outline: Color, paths: Map<Zone.Shape, Path>) {
    when (zone) {
        is Zone.Oval -> rotate(zone.rotate, pivot = Offset(zone.cx, zone.cy)) {
            val topLeft = Offset(zone.cx - zone.rx, zone.cy - zone.ry)
            val size = Size(zone.rx * 2, zone.ry * 2)
            drawOval(fill, topLeft, size)
            drawOval(outline, topLeft, size, style = Stroke(STROKE))
        }
        is Zone.Box -> {
            val corner = CornerRadius(zone.r, zone.r)
            drawRoundRect(fill, Offset(zone.x, zone.y), Size(zone.w, zone.h), corner)
            drawRoundRect(outline, Offset(zone.x, zone.y), Size(zone.w, zone.h), corner, style = Stroke(STROKE))
        }
        is Zone.Shape -> paths[zone]?.let {
            drawPath(it, fill)
            drawPath(it, outline, style = Stroke(STROKE))
        }
    }
}
