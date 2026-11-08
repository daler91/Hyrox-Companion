package com.fitai.coach.ui.theme

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.unit.dp

/** The 4 dp spacing scale (brand kit §5). */
object Spacing {
    val Xxs = 2.dp
    val Xs = 4.dp
    val Sm = 8.dp
    val Md = 12.dp
    val Lg = 16.dp
    val Xl = 20.dp
    val Xxl = 24.dp
    val Xxxl = 32.dp
    val Huge = 48.dp

    /** Page gutter on phones. */
    val Gutter = 24.dp
}

/** Corner radii (brand kit §5). */
object Radius {
    /** Badges, pills. */
    val Sm = RoundedCornerShape(4.dp)

    /** Buttons, inputs. */
    val Md = RoundedCornerShape(8.dp)

    /** Cards. */
    val Lg = RoundedCornerShape(12.dp)

    /** Modals, sheets. */
    val Xl = RoundedCornerShape(20.dp)

    /** Avatars, status dots. */
    val Full = CircleShape
}

/** Motion tokens (brand kit §7). */
object Motion {
    const val MICRO_MS = 120
    const val UI_MS = 200
    const val LAYOUT_MS = 320

    /** Entering elements. */
    val EnterEasing = CubicBezierEasing(0.2f, 0.7f, 0.3f, 1f)

    /** Exiting elements. */
    val ExitEasing = CubicBezierEasing(0.4f, 0f, 1f, 1f)
}

/** Component sizes that the brand kit fixes. */
object Sizes {
    val ButtonSm = 32.dp
    val ButtonMd = 40.dp
    val ButtonLg = 48.dp
    val Input = 44.dp
    val Icon = 20.dp

    /** The minimum touch target (WCAG 2.5.8; Material's 48 dp). */
    val TouchTarget = 48.dp
}
