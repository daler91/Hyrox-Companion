package com.fitai.coach.ui.theme

import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.fitai.coach.ui.resources.Res
import com.fitai.coach.ui.resources.geist
import com.fitai.coach.ui.resources.geist_mono
import com.fitai.coach.ui.resources.space_grotesk
import org.jetbrains.compose.resources.Font
import org.jetbrains.compose.resources.FontResource

/**
 * The type scale (brand kit §4): Space Grotesk for headings, Geist for UI and
 * body, Geist Mono for every number in a data context. Metrics use tabular
 * figures so columns of numbers line up.
 */
@Immutable
data class FitaiTypography(
    val display: TextStyle,
    val h1: TextStyle,
    val h2: TextStyle,
    val h3: TextStyle,
    val body: TextStyle,
    val bodySm: TextStyle,
    val label: TextStyle,
    val button: TextStyle,
    val metricXl: TextStyle,
    val metric: TextStyle,
    val mono: TextStyle,
)

/**
 * One family per variable font file: each weight is a named instance of the
 * same `wght` axis, so the app bundles three files rather than nine.
 */
@Composable
private fun variableFamily(resource: FontResource, vararg weights: Int): FontFamily = FontFamily(
    weights.map { weight ->
        Font(
            resource = resource,
            weight = FontWeight(weight),
            variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
        )
    },
)

@Composable
internal fun fitaiTypography(): FitaiTypography {
    val heading = variableFamily(Res.font.space_grotesk, 500, 600, 700)
    val sans = variableFamily(Res.font.geist, 400, 500, 600)
    val mono = variableFamily(Res.font.geist_mono, 400, 500, 700)
    val tabular = "tnum"
    return FitaiTypography(
        display = TextStyle(
            fontFamily = heading,
            fontWeight = FontWeight.Bold,
            fontSize = 60.sp,
            lineHeight = 64.sp,
            letterSpacing = (-0.03).em,
        ),
        h1 = TextStyle(
            fontFamily = heading,
            fontWeight = FontWeight.Bold,
            fontSize = 40.sp,
            lineHeight = 44.sp,
            letterSpacing = (-0.02).em,
        ),
        h2 = TextStyle(
            fontFamily = heading,
            fontWeight = FontWeight.SemiBold,
            fontSize = 28.sp,
            lineHeight = 32.sp,
            letterSpacing = (-0.015).em,
        ),
        h3 = TextStyle(
            fontFamily = heading,
            fontWeight = FontWeight.SemiBold,
            fontSize = 20.sp,
            lineHeight = 28.sp,
            letterSpacing = (-0.01).em,
        ),
        body = TextStyle(fontFamily = sans, fontWeight = FontWeight.Normal, fontSize = 16.sp, lineHeight = 24.sp),
        bodySm = TextStyle(fontFamily = sans, fontWeight = FontWeight.Normal, fontSize = 14.sp, lineHeight = 20.sp),
        label = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.08.em),
        button = TextStyle(fontFamily = sans, fontWeight = FontWeight.Medium, fontSize = 14.sp, lineHeight = 20.sp),
        metricXl = TextStyle(
            fontFamily = mono,
            fontWeight = FontWeight.Bold,
            fontSize = 48.sp,
            lineHeight = 52.sp,
            letterSpacing = (-0.02).em,
            fontFeatureSettings = tabular,
        ),
        metric = TextStyle(
            fontFamily = mono,
            fontWeight = FontWeight.Bold,
            fontSize = 32.sp,
            lineHeight = 36.sp,
            letterSpacing = (-0.01).em,
            fontFeatureSettings = tabular,
        ),
        mono = TextStyle(
            fontFamily = mono,
            fontWeight = FontWeight.Medium,
            fontSize = 14.sp,
            lineHeight = 20.sp,
            fontFeatureSettings = tabular,
        ),
    )
}
